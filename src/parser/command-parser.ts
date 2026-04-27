import { ParsedIntent, TaskStatus } from '../tasks/models.js';
import { config } from '../config.js';

const PREFIX = config.commandPrefix;

/**
 * Structured result for skill/cron subcommands.
 * These are handled directly by their managers, not through TaskManager.
 */
export interface ManagerCommand {
  type: 'skill' | 'cron';
  subcommand: string;
  args: string[];
}

export type CommandResult =
  | { kind: 'intent'; intent: ParsedIntent }
  | { kind: 'manager'; command: ManagerCommand }
  | null;

export function parseCommand(text: string, mentions: string[]): CommandResult {
  const trimmed = text.trim();

  if (!trimmed.startsWith(PREFIX)) return null;

  const withoutPrefix = trimmed.slice(PREFIX.length).trim();
  const parts = withoutPrefix.split(/\s+/);
  const command = parts[0]?.toLowerCase();

  switch (command) {
    case 'task': {
      // !task Design login page @+1234567890 by Friday
      const rest = parts.slice(1).join(' ');
      if (!rest) {
        return {
          kind: 'intent',
          intent: { intent: 'SHOW_HELP', confidence: 1.0 },
        };
      }
      const byMatch = rest.match(/\bby\s+(.+)$/i);
      const deadline = byMatch?.[1] || undefined;
      const title = rest
        .replace(/\bby\s+.+$/i, '')
        .replace(/@[\d+]+/g, '')
        .trim();

      return {
        kind: 'intent',
        intent: {
          intent: 'CREATE_TASK',
          task: {
            title: title || 'Untitled task',
            assigneePhone: mentions[0] || undefined,
            deadline,
          },
          confidence: 1.0,
        },
      };
    }

    case 'done': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) {
        return {
          kind: 'intent',
          intent: { intent: 'SHOW_HELP', confidence: 1.0 },
        };
      }
      return {
        kind: 'intent',
        intent: {
          intent: 'UPDATE_STATUS',
          task: { relatedTaskId: taskId, status: 'done' as TaskStatus },
          confidence: 1.0,
        },
      };
    }

    case 'status': {
      return { kind: 'intent', intent: { intent: 'QUERY_STATUS', confidence: 1.0 } };
    }

    case 'my': {
      return { kind: 'intent', intent: { intent: 'QUERY_STATUS', confidence: 1.0 } };
    }

    case 'assign': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId) || !mentions[0]) return null;
      return {
        kind: 'intent',
        intent: {
          intent: 'ASSIGN_TASK',
          task: { relatedTaskId: taskId, assigneePhone: mentions[0] },
          confidence: 1.0,
        },
      };
    }

    case 'test': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;
      return {
        kind: 'intent',
        intent: {
          intent: 'UPDATE_STATUS',
          task: { relatedTaskId: taskId, status: 'testing' as TaskStatus },
          confidence: 1.0,
        },
      };
    }

    case 'deadline': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;
      const deadline = parts.slice(2).join(' ');
      return {
        kind: 'intent',
        intent: {
          intent: 'SET_DEADLINE',
          task: { relatedTaskId: taskId, deadline },
          confidence: 1.0,
        },
      };
    }

    case 'edit': {
      // !edit <task_id> <field> <new_value>
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;

      const field = parts[2]?.toLowerCase();
      const value = parts.slice(3).join(' ');

      const fieldMap: Record<string, string> = {
        'title': 'title',
        'desc': 'description',
        'description': 'description',
        'priority': 'priority',
        'status': 'status',
      };

      if (!fieldMap[field]) {
        return {
          kind: 'intent',
          intent: {
            intent: 'EDIT_TASK',
            task: { relatedTaskId: taskId },
            confidence: 0, // Will trigger help message
          },
        };
      }

      return {
        kind: 'intent',
        intent: {
          intent: 'EDIT_TASK',
          task: {
            relatedTaskId: taskId,
            editField: fieldMap[field],
            editValue: value,
          },
          confidence: 1.0,
        },
      };
    }

    case 'delete': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;
      return {
        kind: 'intent',
        intent: {
          intent: 'DELETE_TASK',
          task: { relatedTaskId: taskId },
          confidence: 1.0,
        },
      };
    }

    case 'reopen': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;
      return {
        kind: 'intent',
        intent: {
          intent: 'UPDATE_STATUS',
          task: { relatedTaskId: taskId, status: 'todo' as TaskStatus },
          confidence: 1.0,
        },
      };
    }

    case 'help': {
      const subcommand = parts[1]?.toLowerCase();
      return {
        kind: 'intent',
        intent: {
          intent: 'SHOW_HELP',
          task: subcommand ? { title: subcommand } : undefined,
          confidence: 1.0,
        },
      };
    }

    case 'dashboard':
    case 'chart': {
      return {
        kind: 'intent',
        intent: { intent: 'DASHBOARD_CHART', confidence: 1.0 },
      };
    }

    // --- Skill Management (routed to SkillManager) ---
    case 'skill': {
      const subcommand = parts[1]?.toLowerCase() || 'list';
      const args = parts.slice(2);
      return { kind: 'manager', command: { type: 'skill', subcommand, args } };
    }

    // --- Cron Job Management (routed to CronManager) ---
    case 'cron': {
      const subcommand = parts[1]?.toLowerCase() || 'list';
      const args = parts.slice(2);
      return { kind: 'manager', command: { type: 'cron', subcommand, args } };
    }

    default:
      return null;
  }
}

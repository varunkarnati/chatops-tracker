import { ParsedIntent, TaskStatus } from '../tasks/models.js';
import { config } from '../config.js';

const PREFIX = config.commandPrefix;

export function parseCommand(text: string, mentions: string[]): ParsedIntent | null {
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
          intent: 'SHOW_HELP' as any,
          confidence: 1.0,
        };
      }
      const byMatch = rest.match(/\bby\s+(.+)$/i);
      const deadline = byMatch?.[1] || undefined;
      const title = rest
        .replace(/\bby\s+.+$/i, '')
        .replace(/@[\d+]+/g, '')
        .trim();

      return {
        intent: 'CREATE_TASK',
        task: {
          title: title || 'Untitled task',
          assigneePhone: mentions[0] || undefined,
          deadline,
        },
        confidence: 1.0,
      };
    }

    case 'done': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) {
        // !done without an ID — show usage hint
        return {
          intent: 'SHOW_HELP' as any,
          confidence: 1.0,
        };
      }
      return {
        intent: 'UPDATE_STATUS',
        task: { relatedTaskId: taskId, status: 'done' as TaskStatus },
        confidence: 1.0,
      };
    }

    case 'status': {
      return { intent: 'QUERY_STATUS', confidence: 1.0 };
    }

    case 'my': {
      return { intent: 'QUERY_STATUS', confidence: 1.0 };
    }

    case 'assign': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId) || !mentions[0]) return null;
      return {
        intent: 'ASSIGN_TASK',
        task: { relatedTaskId: taskId, assigneePhone: mentions[0] },
        confidence: 1.0,
      };
    }

    case 'block': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;
      const reason = parts.slice(2).join(' ') || 'No reason given';
      return {
        intent: 'BLOCK_TASK',
        task: { relatedTaskId: taskId, status: 'blocked' as TaskStatus, blockReason: reason },
        confidence: 1.0,
      };
    }

    case 'deadline': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;
      const deadline = parts.slice(2).join(' ');
      return {
        intent: 'SET_DEADLINE',
        task: { relatedTaskId: taskId, deadline },
        confidence: 1.0,
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
          intent: 'EDIT_TASK',
          task: { relatedTaskId: taskId },
          confidence: 0, // Will trigger help message
        };
      }

      return {
        intent: 'EDIT_TASK',
        task: {
          relatedTaskId: taskId,
          editField: fieldMap[field],
          editValue: value,
        },
        confidence: 1.0,
      };
    }

    case 'delete': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;
      return {
        intent: 'DELETE_TASK',
        task: { relatedTaskId: taskId },
        confidence: 1.0,
      };
    }

    case 'reopen': {
      const taskId = parseInt(parts[1]);
      if (isNaN(taskId)) return null;
      return {
        intent: 'UPDATE_STATUS',
        task: { relatedTaskId: taskId, status: 'todo' as TaskStatus },
        confidence: 1.0,
      };
    }

    case 'help': {
      const subcommand = parts[1]?.toLowerCase();
      return {
        intent: 'SHOW_HELP' as any,
        task: subcommand ? { title: subcommand } : undefined,
        confidence: 1.0,
      };
    }

    // --- Skill Management ---
    case 'skill': {
      // Handled by SkillManager in managers layer — return null to pass through
      return null;
    }

    // --- Cron Job Management ---
    case 'cron': {
      // Handled by CronManager in managers layer — return null to pass through
      return null;
    }

    default:
      return null;
  }
}

import { database } from '../db/database.js';
import { ParsedIntent, Task, TeamMember } from './models.js';

interface TaskResponse {
  message: string;
  task?: Task;
}

export class TaskManager {
  handleIntent(
    intent: ParsedIntent,
    projectId: string,
    sender: TeamMember,
    mentions: string[]
  ): TaskResponse | null {
    if (intent.intent === 'GENERAL_CHAT') return null;
    if (intent.confidence < 0.7 && intent.intent !== 'QUERY_STATUS') return null;

    switch (intent.intent) {
      case 'CREATE_TASK':
        return this.createTask(intent, projectId, sender);

      case 'UPDATE_STATUS':
        return this.updateStatus(intent, projectId, sender);

      case 'QUERY_STATUS':
        return this.queryStatus(projectId, sender);

      case 'ASSIGN_TASK':
        return this.assignTask(intent, projectId, sender);

      case 'BLOCK_TASK':
        return this.blockTask(intent, projectId, sender);

      case 'EDIT_TASK':
        return this.editTask(intent, projectId, sender);

      case 'DELETE_TASK':
        return this.deleteTask(intent, projectId, sender);

      default:
        return null;
    }
  }

  private createTask(intent: ParsedIntent, projectId: string, sender: TeamMember): TaskResponse {
    const assignee = intent.task?.assigneePhone
      ? database.findMemberByPhone(intent.task.assigneePhone)
      : undefined;

    const task = database.createTask({
      projectId,
      title: intent.task?.title || 'Untitled task',
      status: 'todo',
      priority: intent.task?.priority || 'medium',
      assignedTo: assignee?.id || sender.id,
      createdBy: sender.id,
      deadline: intent.task?.deadline || undefined,
    });

    const assigneeName = assignee?.name || sender.name;
    const deadlineStr = task.deadline ? `\n📅 Due: ${task.deadline}` : '';
    const priorityEmoji = { low: '🟢', medium: '🟡', high: '🟠', critical: '🔴' };

    return {
      message: [
        `✅ *Task #${task.displayId} Created*`,
        `━━━━━━━━━━━━━━━━━`,
        `📌 ${task.title}`,
        `👤 Assigned to: ${assigneeName}`,
        `${priorityEmoji[task.priority as keyof typeof priorityEmoji] || '🟡'} Priority: ${task.priority}`,
        deadlineStr,
      ].filter(Boolean).join('\n'),
      task,
    };
  }

  private updateStatus(intent: ParsedIntent, projectId: string, sender: TeamMember): TaskResponse {
    const newStatus = intent.task?.status || 'done';

    // Try by explicit task ID first
    if (intent.task?.relatedTaskId) {
      const task = database.updateTaskStatus(
        intent.task.relatedTaskId, projectId, newStatus, sender.id
      );
      if (task) {
        const emoji = { todo: '📋', in_progress: '🔄', review: '👀', done: '✅', blocked: '🚫' };
        return {
          message: `${emoji[newStatus as keyof typeof emoji] || '📋'} *Task #${task.displayId}* → *${newStatus.toUpperCase()}*\n📌 ${task.title}`,
          task,
        };
      }
    }

    // Try fuzzy matching by title
    if (intent.task?.title) {
      const task = database.findTaskByTitle(projectId, intent.task.title);
      if (task) {
        const updated = database.updateTaskStatus(task.displayId, projectId, newStatus, sender.id);
        if (updated) {
          return {
            message: `✅ *Task #${updated.displayId}* → *${newStatus.toUpperCase()}*\n📌 ${updated.title}`,
            task: updated,
          };
        }
      }
    }

    return { message: `❓ Couldn't find a matching task to update. Try \`!done <task_id>\`` };
  }

  private queryStatus(projectId: string, sender: TeamMember): TaskResponse {
    const tasks = database.getTasksByProject(projectId);

    if (tasks.length === 0) {
      return { message: '🎉 *No open tasks!* Your board is clear.' };
    }

    const statusGroups: Record<string, Task[]> = {};
    for (const t of tasks) {
      (statusGroups[t.status] ??= []).push(t);
    }

    const emoji: Record<string, string> = {
      todo: '📋', in_progress: '🔄', review: '👀', blocked: '🚫', done: '✅'
    };

    let msg = `📊 *Project Status* (${tasks.length} open tasks)\n━━━━━━━━━━━━━━━━━\n`;

    for (const [status, items] of Object.entries(statusGroups)) {
      msg += `\n${emoji[status] || '📋'} *${status.toUpperCase()}* (${items.length})\n`;
      for (const t of items.slice(0, 5)) {
        const assignee = t.assignedTo
          ? database.findMemberByPhone(t.assignedTo)?.name || 'Unassigned'
          : 'Unassigned';
        msg += `  #${t.displayId} ${t.title} → ${assignee}\n`;
      }
      if (items.length > 5) msg += `  ... and ${items.length - 5} more\n`;
    }

    return { message: msg };
  }

  private assignTask(intent: ParsedIntent, projectId: string, sender: TeamMember): TaskResponse {
    if (!intent.task?.relatedTaskId || !intent.task.assigneePhone) {
      return { message: '❓ Usage: `!assign <task_id> @person`' };
    }

    const assignee = database.findMemberByPhone(intent.task.assigneePhone);
    if (!assignee) {
      return { message: '❓ Could not find that team member.' };
    }

    return {
      message: `👤 *Task #${intent.task.relatedTaskId}* reassigned to *${assignee.name}*`,
    };
  }

  private blockTask(intent: ParsedIntent, projectId: string, sender: TeamMember): TaskResponse {
    if (!intent.task?.relatedTaskId) {
      return { message: '❓ Usage: `!block <task_id> <reason>`' };
    }

    const task = database.updateTaskStatus(
      intent.task.relatedTaskId, projectId, 'blocked', sender.id
    );

    if (!task) return { message: '❓ Task not found.' };

    return {
      message: `🚫 *Task #${task.displayId} BLOCKED*\n📌 ${task.title}\n💬 Reason: ${intent.task.blockReason || 'Not specified'}`,
      task,
    };
  }

  private editTask(intent: ParsedIntent, projectId: string, sender: TeamMember): TaskResponse {
    if (!intent.task?.relatedTaskId) {
      return { message: '❓ Usage: `!edit <task_id> <field> <new_value>`\nFields: title, desc, priority, status' };
    }

    if (!intent.task.editField || !intent.task.editValue) {
      return { message: '❓ Usage: `!edit <task_id> <field> <new_value>`\nFields: title, desc, priority, status' };
    }

    const task = database.updateTaskField(
      intent.task.relatedTaskId, projectId,
      intent.task.editField, intent.task.editValue,
      sender.id
    );

    if (!task) return { message: '❓ Task not found or invalid field.' };

    return {
      message: `✏️ *Task #${task.displayId} Updated*\n📌 ${intent.task.editField}: ${intent.task.editValue}`,
      task,
    };
  }

  private deleteTask(intent: ParsedIntent, projectId: string, sender: TeamMember): TaskResponse {
    if (!intent.task?.relatedTaskId) {
      return { message: '❓ Usage: `!delete <task_id>`' };
    }

    // Only admins can delete
    if (sender.role !== 'admin') {
      return { message: `🔒 Only admins can delete tasks. Ask an admin to run \`!delete ${intent.task.relatedTaskId}\`.` };
    }

    const task = database.getTaskByDisplayId(intent.task.relatedTaskId, projectId);
    if (!task) return { message: '❓ Task not found.' };

    database.deleteTask(task.id);
    return {
      message: `🗑️ *Task #${intent.task.relatedTaskId} deleted*\n📌 ${task.title}`,
    };
  }
}

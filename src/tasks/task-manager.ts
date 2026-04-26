import { database } from '../db/database.js';
import { ParsedIntent, Task, TeamMember } from './models.js';
import { CronManager } from '../managers/cron-manager.js';
import cron from 'node-cron';

interface TaskResponse {
  message: string;
  task?: Task;
}

export class TaskManager {
  constructor(private cronManager?: CronManager) {}

  handleIntent(
    intent: ParsedIntent,
    projectId: string,
    sender: TeamMember,
    mentions: string[]
  ): TaskResponse | null {
    if (intent.intent === 'GENERAL_CHAT') return null;
    if (intent.confidence < 0.7 && !['QUERY_STATUS', 'SHOW_HELP', 'CREATE_CRON'].includes(intent.intent)) return null;

    switch (intent.intent) {
      case 'CREATE_TASK':
        return this.createTask(intent, projectId, sender);

      case 'CREATE_CRON' as any:
        return this.createCron(intent, projectId, sender);

      case 'UPDATE_STATUS':
        return this.updateStatus(intent, projectId, sender);

      case 'QUERY_STATUS':
        return this.queryStatus(projectId, sender);

      case 'SHOW_HELP' as any:
        return this.showHelp();

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
    let assignee = intent.task?.assigneePhone
      ? database.findMemberByPhone(intent.task.assigneePhone)
      : undefined;

    // Fallback to name lookup if phone failed
    if (!assignee && intent.task?.assigneePhone) {
      assignee = database.findMemberByName(intent.task.assigneePhone, projectId);
    }

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

  private createCron(intent: ParsedIntent, projectId: string, sender: TeamMember): TaskResponse {
    if (!this.cronManager) return { message: '❌ Cron management is not initialized.' };
    if (!intent.cron?.schedule || !intent.cron.message) {
      return { message: '❓ I couldn\'t understand the schedule or the message for the reminder.' };
    }

    try {
      // If it's natural language, we might need a better parser, 
      // but for now let's try to see if it's already a valid cron string
      let schedule = intent.cron.schedule;
      if (!cron.validate(schedule)) {
        // Fallback: If it's something like "every day at 10am", we could parse it,
        // but let's assume the LLM tries its best to output a cron string.
        return { message: `❌ Invalid schedule format: \`${schedule}\`. Please use cron format or be more specific.` };
      }

      const job = this.cronManager.addJob({
        name: intent.cron.name || 'Custom Reminder',
        schedule: schedule,
        actionType: 'custom_message',
        actionConfig: { projectId },
        messageTemplate: intent.cron.message,
        targetGroupId: projectId, // Project ID is the group ID in this setup
        enabled: true,
      });

      return {
        message: [
          `⏰ *Cron Job #${job.display_id} Created*`,
          `━━━━━━━━━━━━━━━━━`,
          `📝 Name: ${job.name}`,
          `📅 Schedule: \`${job.schedule}\``,
          `💬 Message: ${job.message_template}`,
        ].join('\n'),
      };
    } catch (error: any) {
      return { message: `❌ Failed to create cron job: ${error.message}` };
    }
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
        // assignedTo is a member UUID, look up by ID not phone
        const assigneeName = t.assignedTo
          ? database.findMemberById(t.assignedTo)?.name || 'Unassigned'
          : 'Unassigned';
        msg += `  #${t.displayId} ${t.title} → ${assigneeName}\n`;
      }
      if (items.length > 5) msg += `  ... and ${items.length - 5} more\n`;
    }

    return { message: msg };
  }

  showHelp(section?: string): TaskResponse {
    if (section === 'skills') {
      return {
        message: [
          `🎯 *Skill Commands*`,
          `━━━━━━━━━━━━━━━━━`,
          `\`!skill list\` — List all skills`,
          `\`!skill add <name>\` — Create a new skill`,
          `\`!skill info <name>\` — View skill details`,
          `\`!skill edit <name> trigger <keywords>\` — Edit triggers`,
          `\`!skill disable <name>\` — Disable a skill`,
          `\`!skill enable <name>\` — Re-enable a skill`,
          `\`!skill delete <name>\` — Remove a skill`,
        ].join('\n'),
      };
    }

    if (section === 'cron') {
      return {
        message: [
          `⏰ *Cron Commands*`,
          `━━━━━━━━━━━━━━━━━`,
          `\`!cron list\` — List all scheduled jobs`,
          `\`!cron add <schedule> <action>\` — Add a job`,
          `\`!cron pause <id>\` — Pause a job`,
          `\`!cron resume <id>\` — Resume a job`,
          `\`!cron run <id>\` — Run a job now`,
          `\`!cron delete <id>\` — Remove a job`,
        ].join('\n'),
      };
    }

    return {
      message: [
        `🤖 *${process.env.BOT_NAME || 'TaskBot'} — Help*`,
        `━━━━━━━━━━━━━━━━━`,
        ``,
        `📋 *Task Commands:*`,
        `\`!task <title>\` — Create a task`,
        `\`!task <title> @person by <date>\` — Create + assign + deadline`,
        `\`!done <id>\` — Mark task as done`,
        `\`!status\` — Show all tasks`,
        `\`!my\` — Show my tasks`,
        `\`!assign <id> @person\` — Reassign task`,
        `\`!edit <id> title <text>\` — Edit task title`,
        `\`!edit <id> priority <level>\` — Edit priority`,
        `\`!edit <id> desc <text>\` — Edit description`,
        `\`!block <id> <reason>\` — Mark as blocked`,
        `\`!reopen <id>\` — Reopen a task`,
        `\`!delete <id>\` — Delete a task (admin)`,
        ``,
        `📚 *More help:*`,
        `\`!help skills\` — Skill management commands`,
        `\`!help cron\` — Cron job commands`,
        ``,
        `💡 You can also chat naturally and I'll try to track tasks automatically!`,
      ].join('\n'),
    };
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

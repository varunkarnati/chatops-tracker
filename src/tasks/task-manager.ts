import { database } from '../db/database.js';
import { ParsedIntent, Task, TeamMember } from './models.js';
import { CronManager } from '../managers/cron-manager.js';
import { SandboxManager } from '../managers/sandbox-manager.js';
import cron from 'node-cron';

interface TaskResponse {
  message: string;
  task?: Task;
}

export class TaskManager {
  private sandboxManager: SandboxManager;

  constructor(private cronManager?: CronManager) {
    this.sandboxManager = new SandboxManager();
    this.sandboxManager.init().catch(e => console.error('Sandbox init error:', e));
  }

  async handleIntent(
    intent: ParsedIntent,
    projectId: string,
    sender: TeamMember,
    mentions: string[],
    groupId: string
  ): Promise<TaskResponse | null> {
    if (intent.intent === 'GENERAL_CHAT') return null;
    if (intent.confidence < 0.7 && !['QUERY_STATUS', 'SHOW_HELP', 'CREATE_CRON', 'DASHBOARD_CHART', 'EXECUTE_CODE'].includes(intent.intent)) return null;

    switch (intent.intent) {
      case 'CREATE_TASK':
        return this.createTask(intent, projectId, sender, mentions);

      case 'CREATE_CRON' as any:
        return this.createCron(intent, projectId, sender, groupId);

      case 'DASHBOARD_CHART' as any:
        return this.generateChart(projectId, groupId);

      case 'EXECUTE_CODE':
        return await this.executeCodeTask(intent);

      case 'UPDATE_STATUS':
        return this.updateStatus(intent, projectId, sender);

      case 'QUERY_STATUS':
        return this.queryStatus(projectId, sender);

      case 'SHOW_HELP' as any:
        return this.showHelp();

      case 'ASSIGN_TASK':
        return this.assignTask(intent, projectId, sender, mentions);

      case 'EDIT_TASK':
        return this.editTask(intent, projectId, sender);

      case 'DELETE_TASK':
        return this.deleteTask(intent, projectId, sender);

      default:
        return null;
    }
  }

  private async executeCodeTask(intent: ParsedIntent): Promise<TaskResponse> {
    if (!intent.code || !intent.code.snippet || !intent.code.language) {
      return { message: '❌ Invalid code execution request. Missing language or snippet.' };
    }
    
    const result = await this.sandboxManager.executeCode(intent.code.language, intent.code.snippet);
    
    return {
      message: `💻 *Sandbox Execution Result* (${intent.code.language})\n━━━━━━━━━━━━━━━━━\n\`\`\`\n${result}\n\`\`\``
    };
  }

  private createTask(intent: ParsedIntent, projectId: string, sender: TeamMember, mentions: string[] = []): TaskResponse {
    // 1. Try LLM-extracted assignee phone
    let assignee = intent.task?.assigneePhone
      ? database.findMemberByPhone(intent.task.assigneePhone)
      : undefined;

    // 2. Fallback to name lookup
    if (!assignee && intent.task?.assigneePhone) {
      assignee = database.findMemberByName(intent.task.assigneePhone, projectId);
    }

    // 3. Fallback to WhatsApp @mentions (crucial when LLM doesn't extract the phone)
    if (!assignee && mentions.length > 0) {
      for (const mention of mentions) {
        const found = database.findMemberByPhone(mention);
        if (found) {
          assignee = found;
          break;
        }
      }
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

  private createCron(intent: ParsedIntent, projectId: string, sender: TeamMember, groupId: string): TaskResponse {
    if (!this.cronManager) return { message: '❌ Cron management is not initialized.' };
    if (!intent.cron?.schedule || !intent.cron.message) {
      return { message: '❓ I couldn\'t understand the schedule or the message for the reminder.' };
    }

    try {
      let schedule = intent.cron.schedule;
      if (!cron.validate(schedule)) {
        return { message: `❌ Invalid schedule format: \`${schedule}\`. Please use cron format or be more specific.` };
      }

      const job = this.cronManager.addJob({
        name: intent.cron.name || 'Custom Reminder',
        schedule: schedule,
        actionType: 'custom_message',
        actionConfig: { projectId },
        messageTemplate: intent.cron.message,
        targetGroupId: groupId, // FIXED: use WhatsApp group ID, not database UUID
        enabled: true,
        createdBy: sender.id,
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

  private generateChart(projectId: string, groupId: string): TaskResponse {
    const tasks = database.getTasksByProject(projectId);
    const counts: Record<string, number> = { todo: 0, in_progress: 0, review: 0, blocked: 0, done: 0 };
    
    tasks.forEach(t => {
      counts[t.status] = (counts[t.status] || 0) + 1;
    });

    // Also get done tasks from DB for the chart
    const doneTasks = database.getTasksByProject(projectId, 'done');
    counts.done = doneTasks.length;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) return { message: '📊 *No tasks to chart!* Add some tasks first.' };

    const allTasks = [...tasks, ...doneTasks].sort((a, b) => a.displayId - b.displayId);
    
    if (allTasks.length === 0) return { message: '📊 *No tasks to show!*' };

    const statusMap: Record<string, string> = {
      todo: 'TO DO',
      in_progress: 'IN PROGRESS',
      testing: 'TESTING',
      done: 'DONE'
    };

    const rows = allTasks.map(t => {
      const assignee = t.assignedTo ? (database.findMemberById(t.assignedTo)?.name || 'Unassigned') : 'Unassigned';
      return [
        `#${t.displayId}`,
        t.title.length > 30 ? t.title.substring(0, 27) + '...' : t.title,
        statusMap[t.status] || t.status.toUpperCase(),
        assignee
      ];
    });

    // Generate Text-based Kanban Board for accessibility
    let board = `📋 *Task Table: ${allTasks.length} items*\n━━━━━━━━━━━━━━━━━\n`;
    
    const categories = [
      { key: 'todo', label: 'TO DO 📋', emoji: '⚪' },
      { key: 'in_progress', label: 'IN PROGRESS 🔄', emoji: '🔵' },
      { key: 'testing', label: 'TESTING 🧪', emoji: '🧪' },
      { key: 'done', label: 'DONE ✅', emoji: '🟢' }
    ];

    for (const cat of categories) {
      const catTasks = allTasks.filter(t => t.status === cat.key);
      if (catTasks.length > 0) {
        board += `\n*${cat.label}* (${catTasks.length})\n`;
        for (const t of catTasks.slice(0, 5)) {
          const assignee = t.assignedTo ? (database.findMemberById(t.assignedTo)?.name || 'Unassigned') : 'Unassigned';
          board += `  ${cat.emoji} #${t.displayId} ${t.title} (@${assignee})\n`;
        }
      }
    }
    const chartConfig = {
      type: 'doughnut',
      data: {
        labels: ['To Do', 'In Progress', 'Testing', 'Done'],
        datasets: [{
          data: [
            allTasks.filter(t => t.status === 'todo').length,
            allTasks.filter(t => t.status === 'in_progress').length,
            allTasks.filter(t => t.status === 'testing').length,
            allTasks.filter(t => t.status === 'done').length
          ],
          backgroundColor: ['#94a3b8', '#3b82f6', '#8b5cf6', '#22c55e']
        }]
      },
      options: {
        plugins: {
          datalabels: {
            display: true,
            color: '#fff',
            font: { weight: 'bold', size: 16 }
          },
          doughnutlabel: {
            labels: [
              { text: allTasks.length.toString(), font: { size: 40, weight: 'bold' } },
              { text: 'Total Tasks' }
            ]
          }
        }
      }
    };

    const chartUrl = `https://quickchart.io/chart?c=${encodeURIComponent(JSON.stringify(chartConfig))}&w=500&h=300`;

    return {
      message: `${board.trimEnd()}\n\n🖼️ *Visual Breakdown*\n${chartUrl}`,
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
        const emoji = { todo: '📋', in_progress: '🔄', testing: '🧪', done: '✅' };
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
          const emoji = { todo: '📋', in_progress: '🔄', testing: '🧪', done: '✅' };
          return {
            message: `${emoji[newStatus as keyof typeof emoji] || '📋'} *Task #${updated.displayId}* → *${newStatus.toUpperCase()}*\n📌 ${updated.title}`,
            task: updated,
          };
        }
      }
    }

    // Auto-guess: If no ID or title matched, check if the sender only has ONE open task
    const userOpenTasks = database.getTasksByProject(projectId).filter(t => t.assignedTo === sender.id && t.status !== 'done');
    if (userOpenTasks.length === 1) {
      const task = userOpenTasks[0];
      const updated = database.updateTaskStatus(task.displayId, projectId, newStatus, sender.id);
      if (updated) {
        const emoji = { todo: '📋', in_progress: '🔄', testing: '🧪', done: '✅' };
        return {
          message: `🤖 *Assumed Task*: Since you only have one open task, I updated it for you.\n${emoji[newStatus as keyof typeof emoji] || '📋'} *Task #${updated.displayId}* → *${newStatus.toUpperCase()}*\n📌 ${updated.title}`,
          task: updated,
        };
      }
    } else if (userOpenTasks.length > 1) {
       return { message: `❓ You have ${userOpenTasks.length} open tasks. Please specify which one (e.g., \`#${userOpenTasks[0].displayId}\`).` };
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

  private assignTask(intent: ParsedIntent, projectId: string, sender: TeamMember, mentions: string[] = []): TaskResponse {
    if (!intent.task?.relatedTaskId) {
      return { message: '❓ I know you want to assign a task, but I could not figure out which one. Please reply with the task ID (e.g., #4).' };
    }

    // Try LLM-extracted phone, then WhatsApp mentions
    let assignee = intent.task.assigneePhone
      ? database.findMemberByPhone(intent.task.assigneePhone)
      : undefined;

    if (!assignee && mentions.length > 0) {
      for (const mention of mentions) {
        const found = database.findMemberByPhone(mention);
        if (found) { assignee = found; break; }
      }
    }

    // If no assignee is explicitly mentioned, assume the sender is claiming it ("I'll take it")
    if (!assignee) {
      assignee = sender;
    }

    // Actually update the task assignment in the database
    const task = database.getTaskByDisplayId(intent.task.relatedTaskId, projectId);
    if (!task) return { message: '❓ Task not found.' };

    database.updateTaskField(intent.task.relatedTaskId, projectId, 'assigned_to', assignee.id, sender.id);
    const updated = database.getTaskByDisplayId(intent.task.relatedTaskId, projectId);

    return {
      message: `👤 *Task #${intent.task.relatedTaskId}* reassigned to *${assignee.name}*`,
      task: updated || undefined,
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

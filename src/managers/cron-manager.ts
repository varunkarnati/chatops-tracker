import cron, { ScheduledTask } from 'node-cron';
import { database } from '../db/database.js';
import { WhatsAppAdapter } from '../whatsapp/adapter.js';

interface CronJobRecord {
  id: string;
  displayId: number;
  name: string;
  schedule: string;
  actionType: 'standup' | 'deadline_check' | 'custom_message' | 'report';
  actionConfig: Record<string, any>;
  messageTemplate?: string;
  targetGroupId: string;
  enabled: boolean;
  createdBy?: string;
  lastRunAt?: string;
}

export class CronManager {
  private runningJobs: Map<string, ScheduledTask> = new Map();

  constructor(
    private adapter: WhatsAppAdapter,
  ) {}

  loadAll(projectId: string) {
    const jobs = database.getCronJobs(projectId);
    for (const job of jobs) {
      if (job.enabled) this.scheduleJob(this.normalizeJob(job));
    }
    console.log(`⏰ Loaded ${jobs.length} cron jobs`);
  }

  addJob(job: Omit<CronJobRecord, 'id' | 'displayId'>): any {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron expression: ${job.schedule}`);
    }
    const record = database.createCronJob(job);
    const normalized = this.normalizeJob(record);
    if (normalized.enabled) this.scheduleJob(normalized);
    return record;
  }

  editJob(displayId: number, projectId: string, updates: Partial<Pick<CronJobRecord, 'schedule' | 'actionType' | 'messageTemplate'>>) {
    const job = database.getCronJobByDisplayId(displayId, projectId);
    if (!job) throw new Error('Job not found');
    this.stopJob(job.id);

    if (updates.schedule && !cron.validate(updates.schedule)) {
      throw new Error(`Invalid cron expression: ${updates.schedule}`);
    }
    database.updateCronJob(job.id, updates);

    const updated = database.getCronJobByDisplayId(displayId, projectId)!;
    const normalized = this.normalizeJob(updated);
    if (normalized.enabled) this.scheduleJob(normalized);
    return updated;
  }

  toggleJob(displayId: number, projectId: string, enabled: boolean) {
    const job = database.getCronJobByDisplayId(displayId, projectId);
    if (!job) throw new Error('Job not found');
    database.updateCronJob(job.id, { enabled });
    if (enabled) {
      this.scheduleJob(this.normalizeJob({ ...job, enabled: true }));
    } else {
      this.stopJob(job.id);
    }
  }

  async runNow(displayId: number, projectId: string) {
    const job = database.getCronJobByDisplayId(displayId, projectId);
    if (!job) throw new Error('Job not found');
    await this.executeAction(this.normalizeJob(job));
  }

  deleteJob(displayId: number, projectId: string) {
    const job = database.getCronJobByDisplayId(displayId, projectId);
    if (!job) return;
    this.stopJob(job.id);
    database.deleteCronJob(job.id);
  }

  listJobs(projectId: string): string {
    const jobs = database.getCronJobs(projectId);
    if (jobs.length === 0) return '⏰ *No scheduled jobs.* Use `!cron add` to create one.';

    let msg = `⏰ *Scheduled Jobs* (${jobs.length})\n━━━━━━━━━━━━━━━━━\n`;
    for (const j of jobs) {
      const status = j.enabled ? '🟢' : '⏸️';
      const lastRun = j.last_run_at ? ` | Last: ${j.last_run_at}` : '';
      msg += `${status} #${j.display_id} *${j.name}*\n`;
      msg += `   Schedule: \`${j.schedule}\`${lastRun}\n`;
      msg += `   Action: ${j.action_type}\n\n`;
    }
    return msg;
  }

  private normalizeJob(raw: any): CronJobRecord {
    return {
      id: raw.id,
      displayId: raw.display_id ?? raw.displayId,
      name: raw.name,
      schedule: raw.schedule,
      actionType: raw.action_type ?? raw.actionType,
      actionConfig: typeof raw.action_config === 'string' ? JSON.parse(raw.action_config || '{}') : (raw.actionConfig || {}),
      messageTemplate: raw.message_template ?? raw.messageTemplate,
      targetGroupId: raw.target_group_id ?? raw.targetGroupId,
      enabled: Boolean(raw.enabled),
      lastRunAt: raw.last_run_at ?? raw.lastRunAt,
    };
  }

  private scheduleJob(job: CronJobRecord) {
    const task = cron.schedule(job.schedule, async () => {
      await this.executeAction(job);
      database.updateCronJob(job.id, { last_run_at: new Date().toISOString() });
    });
    this.runningJobs.set(job.id, task);
  }

  private stopJob(jobId: string) {
    const task = this.runningJobs.get(jobId);
    if (task) { task.stop(); this.runningJobs.delete(jobId); }
  }

  private async executeAction(job: CronJobRecord) {
    const projectId = job.actionConfig?.projectId || '';
    switch (job.actionType) {
      case 'standup': {
        const tasks = database.getTasksByProject(projectId);
        const overdue = database.getOverdueTasks(projectId);
        let msg = `🌅 *Good Morning! Daily Standup*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `📋 Open tasks: ${tasks.length}\n`;
        if (overdue.length > 0) {
          msg += `\n⚠️ *OVERDUE (${overdue.length}):*\n`;
          for (const t of overdue) {
            msg += `  🔴 #${t.displayId} ${t.title}\n`;
          }
        }
        if (job.targetGroupId) await this.adapter.sendToGroup(job.targetGroupId, msg);
        break;
      }
      case 'deadline_check': {
        const overdue = database.getOverdueTasks(projectId);
        if (overdue.length > 0 && job.targetGroupId) {
          const msg = `⚠️ *${overdue.length} task(s) past deadline!*\n` +
            overdue.map(t => `  🔴 #${t.displayId} ${t.title}`).join('\n');
          await this.adapter.sendToGroup(job.targetGroupId, msg);
        }
        break;
      }
      case 'custom_message': {
        if (job.messageTemplate && job.targetGroupId) {
          const rendered = this.renderTemplate(job.messageTemplate, projectId);
          await this.adapter.sendToGroup(job.targetGroupId, rendered);
        }
        break;
      }
      case 'report': {
        const tasks = database.getTasksByProject(projectId);
        let msg = `📊 *Weekly Report*\n━━━━━━━━━━━━━━━━━\n`;
        msg += `📋 Open: ${tasks.length}\nGreat work this week! 🚀`;
        if (job.targetGroupId) await this.adapter.sendToGroup(job.targetGroupId, msg);
        break;
      }
    }
  }

  private renderTemplate(template: string, projectId: string): string {
    const tasks = database.getTasksByProject(projectId);
    const overdue = database.getOverdueTasks(projectId);
    return template
      .replace(/\{\{date\}\}/g, new Date().toLocaleDateString())
      .replace(/\{\{open_count\}\}/g, String(tasks.length))
      .replace(/\{\{overdue_count\}\}/g, String(overdue.length))
      .replace(/\{\{day\}\}/g, new Date().toLocaleDateString('en', { weekday: 'long' }));
  }
}

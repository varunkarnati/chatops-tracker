import cron from 'node-cron';
import { database } from '../db/database.js';
import { WhatsAppAdapter } from '../whatsapp/adapter.js';

/**
 * Bootstrap default cron jobs for a newly connected group.
 * These serve as sensible defaults — users can modify/remove them via !cron commands.
 */
export function setupScheduler(adapter: WhatsAppAdapter, projectGroups: Map<string, string>) {
  // ⏰ Daily standup summary — every day at 9:00 AM
  cron.schedule('0 9 * * *', () => {
    for (const [groupId, projectId] of projectGroups) {
      const tasks = database.getTasksByProject(projectId);
      const overdue = database.getOverdueTasks(projectId);

      let msg = `🌅 *Good Morning! Daily Standup*\n━━━━━━━━━━━━━━━━━\n`;
      msg += `📋 Open tasks: ${tasks.length}\n`;

      if (overdue.length > 0) {
        msg += `\n⚠️ *OVERDUE (${overdue.length}):*\n`;
        for (const t of overdue) {
          msg += `  🔴 #${t.displayId} ${t.title} (due: ${t.deadline})\n`;
        }
      }

      msg += `\nType \`!status\` for full breakdown.`;
      adapter.sendToGroup(groupId, msg).catch(console.error);
    }
  });

  // ⏰ Deadline reminder — check every hour during work hours
  cron.schedule('0 10-18 * * 1-5', () => {
    for (const [groupId, projectId] of projectGroups) {
      const overdue = database.getOverdueTasks(projectId);
      if (overdue.length > 0) {
        const msg = `⚠️ *${overdue.length} task(s) past deadline!*\n` +
          overdue.map(t => `  🔴 #${t.displayId} ${t.title}`).join('\n');
        adapter.sendToGroup(groupId, msg).catch(console.error);
      }
    }
  });

  // ⏰ Weekly report — every Friday at 5:00 PM
  cron.schedule('0 17 * * 5', () => {
    for (const [groupId, projectId] of projectGroups) {
      const tasks = database.getTasksByProject(projectId);
      const done = tasks.filter(t => t.status === 'done');

      let msg = `📊 *Weekly Report*\n━━━━━━━━━━━━━━━━━\n`;
      msg += `✅ Completed: ${done.length}\n`;
      msg += `📋 Still open: ${tasks.length - done.length}\n`;
      msg += `\nGreat work this week, team! 🚀`;

      adapter.sendToGroup(groupId, msg).catch(console.error);
    }
  });

  console.log('⏰ Scheduler started (daily standup, hourly deadline checks, weekly report)');
}

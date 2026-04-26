import { WhatsAppAdapter } from './whatsapp/adapter.js';
import { parseCommand } from './parser/command-parser.js';
import { parseLLM } from './parser/llm-parser.js';
import { TaskManager } from './tasks/task-manager.js';
import { database } from './db/database.js';
import { setupScheduler } from './scheduler/cron-jobs.js';
import { ContextAssembler } from './context/assembler.js';
import { SkillManager } from './managers/skill-manager.js';
import { CronManager } from './managers/cron-manager.js';
import { HotReloader } from './managers/hot-reloader.js';
import { DashboardServer } from './dashboard/server.js';
import { config } from './config.js';

async function main() {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║     🤖 ChatOps Tracker v0.1.0        ║
  ║     WhatsApp → Task Management        ║
  ╚═══════════════════════════════════════╝
  `);

  // --- Initialize core components ---
  const adapter = new WhatsAppAdapter();
  const taskManager = new TaskManager();
  const contextAssembler = new ContextAssembler(config.workspacePath);
  const skillManager = new SkillManager(contextAssembler.skillRegistry);
  const cronManager = new CronManager(adapter);
  const _hotReloader = new HotReloader(contextAssembler.skillRegistry, config.workspacePath);

  // --- Initialize dashboard ---
  const dashboard = new DashboardServer(adapter);

  const projectGroups = new Map<string, string>(); // groupId → projectId

  // --- Message handler ---
  adapter.onMessage(async (msg) => {
    try {
      // 1. Ensure project exists for this group
      if (!projectGroups.has(msg.groupId)) {
        const projectId = database.getOrCreateProject(msg.groupId, msg.groupName);
        projectGroups.set(msg.groupId, projectId);
      }
      const projectId = projectGroups.get(msg.groupId)!;

      // 2. Ensure sender is a known team member
      const sender = database.getOrCreateMember(
        msg.senderId.replace('@s.whatsapp.net', ''),
        msg.senderName,
        projectId
      );

      // 3. Try command-based parsing first (explicit commands are instant + free)
      let intent = parseCommand(msg.text, msg.mentions);

      // 4. If no command matched, try LLM-based parsing with full context
      if (!intent) {
        const assembledPrompt = contextAssembler.assemblePrompt(msg, projectId);
        intent = await parseLLM(msg.text, msg.senderName, msg.mentions, assembledPrompt);
      }

      // 5. Handle the parsed intent
      const response = taskManager.handleIntent(intent, projectId, sender, msg.mentions);

      // 6. Send response back to the group
      if (response) {
        await adapter.sendToGroup(msg.groupId, response.message);

        // 7. Broadcast to dashboard clients
        if (response.task) {
          dashboard.sync.broadcastToProject(projectId, 'task:updated', response.task);
        }
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  });

  // --- Connect and start ---
  await adapter.connect();

  // Start default scheduler
  setupScheduler(adapter, projectGroups);

  // Start dashboard API server
  dashboard.start();

  console.log('🚀 ChatOps Tracker is running!');
}

main().catch(console.error);

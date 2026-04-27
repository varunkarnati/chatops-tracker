import { WhatsAppAdapter } from './whatsapp/adapter.js';
import { parseCommand, CommandResult } from './parser/command-parser.js';
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
  ║     🤖 ChatOps Tracker v0.3.0        ║
  ║     WhatsApp → Task Management        ║
  ║     Thread-Aware + Session Memory      ║
  ╚═══════════════════════════════════════╝
  `);

  // --- Initialize core components ---
  const adapter = new WhatsAppAdapter();
  const contextAssembler = new ContextAssembler(config.workspacePath);
  const skillManager = new SkillManager(contextAssembler.skillRegistry);
  const cronManager = new CronManager(adapter);
  const taskManager = new TaskManager(cronManager);
  const _hotReloader = new HotReloader(contextAssembler.skillRegistry, config.workspacePath);

  // --- Initialize dashboard ---
  const dashboard = new DashboardServer(adapter);

  // --- Load all known project groups from DB (survives restarts) ---
  const projectGroups = database.getAllProjectGroups();
  console.log(`📂 Loaded ${projectGroups.size} project groups from database`);

  // Load cron jobs for all known projects at startup
  for (const [_groupId, projectId] of projectGroups) {
    cronManager.loadAll(projectId);
  }

  // --- Message Processing Logic ---
  const processMessage = async (msg: any) => {
    try {
      console.log(`📨 [${msg.senderName}]: ${msg.text}`);

      // 1. Ensure project exists for this group
      if (!projectGroups.has(msg.groupId)) {
        const projectId = database.getOrCreateProject(msg.groupId, msg.groupName);
        projectGroups.set(msg.groupId, projectId);
        cronManager.loadAll(projectId);
      }
      const projectId = projectGroups.get(msg.groupId)!;

      // 2. Ensure sender is a known team member
      const sender = database.getOrCreateMember(
        msg.senderId.replace('@s.whatsapp.net', ''),
        msg.senderName,
        projectId
      );

      // 3. Check for thread context (is this a reply to a task-related bot message?)
      const threadContext = contextAssembler.threadTracker.resolveThread(msg);
      if (threadContext) {
        console.log(`🔗 Thread detected: reply to Task #${threadContext.taskDisplayId}`);
      }

      // 4. Try command-based parsing first (explicit commands are instant + free)
      const commandResult: CommandResult = parseCommand(msg.text, msg.mentions);

      // 5. Handle manager commands (skill/cron) — these are routed directly
      if (commandResult?.kind === 'manager') {
        const response = await handleManagerCommand(
          commandResult.command, projectId, sender, msg.groupId, skillManager, cronManager
        );
        if (response) {
          await adapter.sendToGroup(msg.groupId, response);
        }
        return;
      }

      // 6. Get the intent — from command or LLM
      let intent = commandResult?.kind === 'intent' ? commandResult.intent : null;

      // 7. Handle SHOW_HELP separately
      if (intent && intent.intent === 'SHOW_HELP') {
        const helpSection = intent.task?.title;
        const response = taskManager.showHelp(helpSection);
        await adapter.sendToGroup(msg.groupId, response.message);
        return;
      }

      // 8. If no command matched, try LLM-based parsing with full context
      if (!intent) {
        console.log(`🤔 Thinking... (LLM)`);
        const assembledPrompt = contextAssembler.assemblePrompt(msg, projectId, threadContext);
        intent = await parseLLM(msg.text, msg.senderName, msg.mentions, assembledPrompt);
      }

      // 9. Thread-context intent correction:
      //    When replying to a task message, NEVER create a new task.
      //    Redirect to the appropriate update intent instead.
      if (threadContext) {
        if (intent.intent === 'CREATE_TASK') {
          // A reply to a task that LLM classified as CREATE_TASK is almost certainly
          // an update, assignment, or refinement — not a new task
          if (msg.mentions.length > 0) {
            console.log(`🔗 Thread redirect: CREATE_TASK → ASSIGN_TASK for Task #${threadContext.taskDisplayId}`);
            intent = {
              intent: 'ASSIGN_TASK',
              task: { relatedTaskId: threadContext.taskDisplayId, assigneePhone: msg.mentions[0] },
              confidence: intent.confidence,
            };
          } else {
            console.log(`🔗 Thread redirect: CREATE_TASK → EDIT_TASK for Task #${threadContext.taskDisplayId}`);
            intent = {
              intent: 'EDIT_TASK',
              task: {
                relatedTaskId: threadContext.taskDisplayId,
                editField: 'description',
                editValue: msg.text,
              },
              confidence: intent.confidence,
            };
          }
        }

        // Inject relatedTaskId for any intent that operates on a task
        if (intent.task === undefined) {
          intent = { ...intent, task: { relatedTaskId: threadContext.taskDisplayId } };
        } else if (!intent.task.relatedTaskId) {
          intent = { ...intent, task: { ...intent.task, relatedTaskId: threadContext.taskDisplayId } };
        }
      }

      // 9.5 Fallback: If no relatedTaskId was extracted but this is an update intent,
      //     try to inject the last mentioned task from the user's session
      const updateIntents = ['UPDATE_STATUS', 'ASSIGN_TASK', 'SET_DEADLINE', 'EDIT_TASK', 'ADD_COMMENT', 'SET_PRIORITY'];
      if (!threadContext && updateIntents.includes(intent.intent) && (!intent.task || !intent.task.relatedTaskId)) {
        const session = contextAssembler.sessionManager.getSession(sender.id, projectId);
        if (session && session.lastTaskDisplayId) {
          console.log(`🧠 Pronoun fallback: Injected Task #${session.lastTaskDisplayId} from session context`);
          if (intent.task === undefined) {
            intent = { ...intent, task: { relatedTaskId: session.lastTaskDisplayId } };
          } else {
            intent = { ...intent, task: { ...intent.task, relatedTaskId: session.lastTaskDisplayId } };
          }
        }
      }

      // 10. Handle the parsed intent
      const response = await taskManager.handleIntent(intent, projectId, sender, msg.mentions, msg.groupId);

      // 11. Send response back to the group
      if (response) {
        console.log(`📤 Bot reply: ${response.message.substring(0, 80)}...`);
        const sentMessageId = await adapter.sendToGroup(msg.groupId, response.message);

        // 12. Link bot reply to task for thread tracking
        if (sentMessageId && response.task) {
          contextAssembler.threadTracker.linkBotReply(sentMessageId, response.task, intent.intent);
          console.log(`🔗 Linked message ${sentMessageId} → Task #${response.task.displayId}`);
        }

        // 13. Update user session (for pronoun resolution on next turn)
        contextAssembler.sessionManager.recordAction(
          sender.id, projectId, intent.intent, response.task
        );

        // 14. Broadcast to dashboard clients
        if (response.task) {
          dashboard.sync.broadcastToProject(projectId, 'task:updated', response.task);
        }
      } else if (intent.intent !== 'GENERAL_CHAT') {
        // Update session even for non-response intents (e.g., status queries that return inline)
        contextAssembler.sessionManager.recordAction(sender.id, projectId, intent.intent);
      }
    } catch (error) {
      console.error('Error processing message:', error);
    }
  };

  // Listen to WhatsApp
  adapter.onMessage(processMessage);

  // Listen to Webhooks from Dashboard
  dashboard.onWebhook = async (payload) => {
    const projects = database.getProjects();
    if (projects.length === 0) {
      console.log('⚠️ Webhook received but no projects exist to route it to.');
      return;
    }
    const targetProject = projects[0];
    
    // Construct a synthetic WhatsApp message from the webhook payload
    const simulatedMsg = {
      id: `webhook-${Date.now()}`,
      groupId: targetProject.whatsappGroupId,
      senderId: 'webhook@system',
      senderName: payload.senderName || 'System Alert',
      text: payload.text || JSON.stringify(payload),
      mentions: [],
      timestamp: Date.now()
    };
    
    // Inject custom prefix to help LLM understand it's an external alert
    simulatedMsg.text = `[EXTERNAL WEBHOOK ALERT]\n${simulatedMsg.text}\nPlease log this appropriately.`;
    
    await processMessage(simulatedMsg);
  };

  // --- Connect and start ---
  await adapter.connect();

  // Start default scheduler
  setupScheduler(adapter, projectGroups);

  // Start dashboard API server
  dashboard.start();

  console.log('🚀 ChatOps Tracker is running!');

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    adapter.disconnect();
    database.close();
    console.log('✅ Cleanup complete. Goodbye!');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

/**
 * Handle !skill and !cron commands by routing to the appropriate manager.
 */
async function handleManagerCommand(
  command: { type: 'skill' | 'cron'; subcommand: string; args: string[] },
  projectId: string,
  sender: any,
  groupId: string,
  skillManager: SkillManager,
  cronManager: CronManager,
): Promise<string | null> {
  if (command.type === 'skill') {
    return handleSkillCommand(command.subcommand, command.args, projectId, sender, skillManager);
  }
  if (command.type === 'cron') {
    return handleCronCommand(command.subcommand, command.args, projectId, sender, groupId, cronManager);
  }
  return null;
}

function handleSkillCommand(
  subcommand: string, args: string[], projectId: string, sender: any, skillManager: SkillManager
): string {
  switch (subcommand) {
    case 'list':
      return skillManager.listSkills(projectId);

    case 'add': {
      const name = args[0];
      if (!name) return '❓ Usage: `!skill add <name>`';
      // Create with default triggers/behavior — user can edit later
      skillManager.createSkill(name, [name], `Handle ${name}-related queries`, 'Respond naturally', projectId, sender.id)
        .catch(e => console.error('Skill creation error:', e));
      return `🎯 *Skill "${name}" created!* Use \`!skill edit ${name} trigger <keywords>\` to customize.`;
    }

    case 'info': {
      const name = args[0];
      if (!name) return '❓ Usage: `!skill info <name>`';
      // Return skill details
      return `🎯 Skill info for "${name}" — use \`!skill list\` to see all skills.`;
    }

    case 'disable': {
      const name = args[0];
      if (!name) return '❓ Usage: `!skill disable <name>`';
      try {
        skillManager.toggleSkill(name, false);
        return `⏸️ Skill "${name}" disabled.`;
      } catch (e: any) {
        return `❌ ${e.message}`;
      }
    }

    case 'enable': {
      const name = args[0];
      if (!name) return '❓ Usage: `!skill enable <name>`';
      try {
        skillManager.toggleSkill(name, true);
        return `🟢 Skill "${name}" re-enabled.`;
      } catch (e: any) {
        return `❌ ${e.message}`;
      }
    }

    case 'delete': {
      const name = args[0];
      if (!name) return '❓ Usage: `!skill delete <name>`';
      try {
        skillManager.deleteSkill(name);
        return `🗑️ Skill "${name}" deleted.`;
      } catch (e: any) {
        return `❌ ${e.message}`;
      }
    }

    case 'edit': {
      const name = args[0];
      const field = args[1];
      const value = args.slice(2).join(' ');
      if (!name || !field || !value) return '❓ Usage: `!skill edit <name> trigger <keywords>`';
      if (field === 'trigger' || field === 'triggers') {
        try {
          skillManager.editTriggers(name, value.split(',').map(t => t.trim()));
          return `✏️ Triggers for "${name}" updated: ${value}`;
        } catch (e: any) {
          return `❌ ${e.message}`;
        }
      }
      return `❓ Unknown field "${field}". Supported: trigger`;
    }

    default:
      return `❓ Unknown skill subcommand: "${subcommand}". Try \`!help skills\``;
  }
}

function handleCronCommand(
  subcommand: string, args: string[], projectId: string, sender: any, groupId: string, cronManager: CronManager
): string {
  switch (subcommand) {
    case 'list':
      return cronManager.listJobs(projectId);

    case 'pause': {
      const id = parseInt(args[0]);
      if (isNaN(id)) return '❓ Usage: `!cron pause <id>`';
      try {
        cronManager.toggleJob(id, projectId, false);
        return `⏸️ Cron job #${id} paused.`;
      } catch (e: any) {
        return `❌ ${e.message}`;
      }
    }

    case 'resume': {
      const id = parseInt(args[0]);
      if (isNaN(id)) return '❓ Usage: `!cron resume <id>`';
      try {
        cronManager.toggleJob(id, projectId, true);
        return `🟢 Cron job #${id} resumed.`;
      } catch (e: any) {
        return `❌ ${e.message}`;
      }
    }

    case 'run': {
      const id = parseInt(args[0]);
      if (isNaN(id)) return '❓ Usage: `!cron run <id>`';
      cronManager.runNow(id, projectId).catch(e => console.error('Cron run error:', e));
      return `▶️ Running cron job #${id} now...`;
    }

    case 'delete': {
      const id = parseInt(args[0]);
      if (isNaN(id)) return '❓ Usage: `!cron delete <id>`';
      cronManager.deleteJob(id, projectId);
      return `🗑️ Cron job #${id} deleted.`;
    }

    default:
      return `❓ Unknown cron subcommand: "${subcommand}". Try \`!help cron\``;
  }
}

main().catch(console.error);

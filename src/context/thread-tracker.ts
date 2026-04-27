import { database } from '../db/database.js';
import { NormalizedMessage, Task } from '../tasks/models.js';

/**
 * ThreadTracker — maps bot reply messages to tasks so that when a user
 * replies to a task confirmation, we know which task they're referring to.
 *
 * Flow:
 * 1. Bot creates Task #5, sends confirmation, gets back botMessageId
 * 2. ThreadTracker stores: botMessageId → { taskId, displayId, projectId }
 * 3. User replies to that confirmation: "actually assign this to @Stan"
 * 4. ThreadTracker resolves: quotedMessageId → Task #5
 * 5. Context assembler injects thread context into LLM prompt
 */
export interface ThreadContext {
  taskId: string;
  taskDisplayId: number;
  projectId: string;
  task: Task | undefined;
  intent: string;
}

export class ThreadTracker {
  /**
   * Called after the bot sends a task-related reply.
   * Links the bot's outgoing message ID to the task.
   */
  linkBotReply(botMessageId: string, task: Task, intent: string): void {
    if (!botMessageId || !task.id) return;
    database.linkMessageToTask(botMessageId, task.id, task.displayId, task.projectId, intent);
  }

  /**
   * Given an incoming message, check if it quotes a bot reply that's linked to a task.
   * Returns the thread context if found, null otherwise.
   */
  resolveThread(msg: NormalizedMessage): ThreadContext | null {
    if (!msg.quotedMessage?.id) return null;

    const link = database.getTaskByBotMessageId(msg.quotedMessage.id);
    if (!link) return null;

    // Fetch the current task state
    const task = database.getTaskByDisplayId(link.taskDisplayId, link.projectId);

    return {
      taskId: link.taskId,
      taskDisplayId: link.taskDisplayId,
      projectId: link.projectId,
      task: task || undefined,
      intent: link.intent,
    };
  }

  /**
   * Build a context string for the LLM prompt when a thread is detected.
   */
  buildThreadPrompt(ctx: ThreadContext): string {
    if (!ctx.task) {
      return `## Thread Context\nThe user is replying to a message about Task #${ctx.taskDisplayId}, but that task was not found (may have been deleted).`;
    }

    const assigneeName = ctx.task.assignedTo
      ? database.findMemberById(ctx.task.assignedTo)?.name || 'Unknown'
      : 'Unassigned';

    return [
      `## Thread Context`,
      `The user is replying to a message about an existing task. Interpret their message as an update, refinement, or status change to this task — NOT as a new task creation.`,
      ``,
      `**Referenced Task:**`,
      `- ID: #${ctx.task.displayId}`,
      `- Title: "${ctx.task.title}"`,
      `- Status: ${ctx.task.status}`,
      `- Assigned to: ${assigneeName}`,
      `- Priority: ${ctx.task.priority}`,
      ctx.task.deadline ? `- Deadline: ${ctx.task.deadline}` : '',
      ``,
      `**Important:** The user's message should be interpreted in the context of Task #${ctx.task.displayId}. For example:`,
      `- "assign this to @person" → ASSIGN_TASK with relatedTaskId: ${ctx.task.displayId}`,
      `- "done" or "completed" → UPDATE_STATUS with relatedTaskId: ${ctx.task.displayId}, status: "done"`,
      `- "change the title to X" → EDIT_TASK with relatedTaskId: ${ctx.task.displayId}`,
      `- "blocked by API issues" → BLOCK_TASK with relatedTaskId: ${ctx.task.displayId}`,
      `- "extend deadline to Friday" → SET_DEADLINE with relatedTaskId: ${ctx.task.displayId}`,
      `- Any additional details → UPDATE the existing task, do NOT create a new one`,
    ].filter(Boolean).join('\n');
  }
}

import { database } from '../db/database.js';
import { Task } from '../tasks/models.js';

/**
 * SessionManager — per-user session state for pronoun resolution and continuity.
 *
 * Tracks what each user was last doing so the bot can resolve:
 * - "mark it as done" → "it" = user's last mentioned task
 * - "change the priority" → which task? the one they last interacted with
 * - "what about mine?" → filter to user's assigned tasks
 *
 * Inspired by OpenClaw's memory injection pattern — session state is loaded
 * from DB and injected into the LLM context per turn.
 */
export interface UserSession {
  lastTaskId: string | null;
  lastTaskDisplayId: number | null;
  lastAction: string | null;
  lastIntent: string | null;
  recentIntents: string[];
}

export class SessionManager {
  /**
   * Load user's session for a given project.
   */
  getSession(userId: string, projectId: string): UserSession {
    return database.getUserSession(userId, projectId);
  }

  /**
   * Update session after a successful action.
   */
  recordAction(userId: string, projectId: string, intent: string, task?: Task): void {
    const actionLabel = this.intentToAction(intent);
    database.updateUserSession(userId, projectId, {
      lastTaskId: task?.id,
      lastTaskDisplayId: task?.displayId,
      lastAction: actionLabel,
      lastIntent: intent,
    });
  }

  /**
   * Build a context string for the LLM prompt based on user session.
   * This enables pronoun resolution and continuity.
   */
  buildSessionPrompt(session: UserSession, userId: string): string {
    if (!session.lastTaskId && session.recentIntents.length === 0) {
      return ''; // No session context to inject
    }

    const parts: string[] = ['## User Session Context'];

    if (session.lastTaskDisplayId) {
      const task = database.getTaskByDisplayId(session.lastTaskDisplayId, '');
      // Load from any project since we have the display ID
      const taskInfo = session.lastTaskId
        ? (() => {
            // Try loading by internal ID for accuracy
            const rows = database.getTasksByProject(''); // We'll use a direct lookup
            return null;
          })()
        : null;

      parts.push(`The user's last interaction was with Task #${session.lastTaskDisplayId}.`);
      parts.push(`Last action: ${session.lastAction || 'unknown'}`);
      parts.push(``);
      parts.push(`**Pronoun resolution:** If the user says "it", "that", "this task", "the task", they likely mean Task #${session.lastTaskDisplayId}.`);
      parts.push(`When resolving pronouns, set relatedTaskId: ${session.lastTaskDisplayId} in the JSON output.`);
    }

    if (session.recentIntents.length > 0) {
      const intentSummary = session.recentIntents.slice(-3).join(' → ');
      parts.push(``);
      parts.push(`Recent activity pattern: ${intentSummary}`);
    }

    return parts.join('\n');
  }

  private intentToAction(intent: string): string {
    const map: Record<string, string> = {
      'CREATE_TASK': 'created a task',
      'UPDATE_STATUS': 'updated task status',
      'ASSIGN_TASK': 'assigned a task',
      'SET_DEADLINE': 'set a deadline',
      'QUERY_STATUS': 'checked status',
      'BLOCK_TASK': 'blocked a task',
      'EDIT_TASK': 'edited a task',
      'DELETE_TASK': 'deleted a task',
      'CREATE_CRON': 'created a cron job',
      'DELETE_CRON': 'deleted a cron job',
      'DASHBOARD_CHART': 'viewed the dashboard',
    };
    return map[intent] || intent.toLowerCase();
  }
}

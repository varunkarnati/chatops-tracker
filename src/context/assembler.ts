import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { NormalizedMessage } from '../tasks/models.js';
import { SkillRegistry } from './skill-registry.js';
import { GroupHistory } from './group-history.js';
import { ThreadTracker, ThreadContext } from './thread-tracker.js';
import { SessionManager } from './session-manager.js';
import { database } from '../db/database.js';

/**
 * ContextAssembler — builds the full system prompt per turn by composing 9 layers:
 *
 * Layer 1: AGENT.md (core rules & allowed intents)
 * Layer 2: SOUL.md (personality & communication style)
 * Layer 3: Matched skill (selectively injected based on message triggers)
 * Layer 4: Board snapshot (live task state from DB)
 * Layer 5: Team context (members & workload from DB)
 * Layer 6: Thread context (if replying to a task-related bot message) ← NEW
 * Layer 7: User session (last task, pronoun resolution hints) ← NEW
 * Layer 8: Recent group messages (from DB, persistent across restarts) ← UPGRADED
 * Layer 9: Dynamic metadata (date, time, group name)
 *
 * Inspired by OpenClaw's memory/skill injection architecture.
 */
export class ContextAssembler {
  private agentPrompt: string;
  private soulPrompt: string;
  public skillRegistry: SkillRegistry;
  public groupHistory: GroupHistory;
  public threadTracker: ThreadTracker;
  public sessionManager: SessionManager;

  constructor(workspacePath: string) {
    const agentPath = join(workspacePath, 'AGENT.md');
    const soulPath = join(workspacePath, 'SOUL.md');

    this.agentPrompt = existsSync(agentPath) ? readFileSync(agentPath, 'utf-8') : '';
    this.soulPrompt = existsSync(soulPath) ? readFileSync(soulPath, 'utf-8') : '';
    this.skillRegistry = new SkillRegistry();
    this.skillRegistry.loadFromDirectory(join(workspacePath, 'skills'));
    this.groupHistory = new GroupHistory(30);
    this.threadTracker = new ThreadTracker();
    this.sessionManager = new SessionManager();
  }

  /**
   * Assemble the full system prompt for a given message.
   * Thread context and session are injected when available.
   */
  assemblePrompt(
    message: NormalizedMessage,
    projectId: string,
    threadContext?: ThreadContext | null,
  ): string {
    const parts: string[] = [];

    // Layer 1: Core Identity & Rules
    if (this.agentPrompt) parts.push(this.agentPrompt);

    // Layer 2: Personality
    if (this.soulPrompt) parts.push(this.soulPrompt);

    // Layer 3: Matched Skill
    const matchedSkill = this.skillRegistry.findMatchingSkill(message.text);
    if (matchedSkill) {
      parts.push(`## Active Skill: ${matchedSkill.name}\n${matchedSkill.promptContent}`);
    }

    // Layer 4: Live Board State
    parts.push(this.getBoardSnapshot(projectId));

    // Layer 5: Team Context
    parts.push(this.getTeamContext(projectId));

    // Layer 6: Thread Context (NEW — if replying to a task message)
    if (threadContext) {
      parts.push(this.threadTracker.buildThreadPrompt(threadContext));
    }

    // Layer 7: User Session (NEW — pronoun resolution, continuity)
    const senderId = message.senderId.replace('@s.whatsapp.net', '');
    const session = this.sessionManager.getSession(senderId, projectId);
    const sessionPrompt = this.sessionManager.buildSessionPrompt(session, senderId);
    if (sessionPrompt) parts.push(sessionPrompt);

    // Layer 8: Recent Conversation History (UPGRADED — now DB-backed)
    const history = this.groupHistory.getContext(message.groupId);
    if (history) parts.push(history);

    // Layer 9: Dynamic Metadata
    parts.push(`## Current Context`);
    parts.push(`Today: ${new Date().toISOString().split('T')[0]}`);
    parts.push(`Current time: ${new Date().toLocaleTimeString()}`);
    parts.push(`Group: ${message.groupName}`);

    // Store this message in persistent history for next turn
    this.groupHistory.add(
      message.groupId,
      message.senderName,
      message.senderId,
      message.text,
      message.id,
      message.quotedMessage?.id,
      message.timestamp,
    );

    return parts.join('\n\n---\n\n');
  }

  private getBoardSnapshot(projectId: string): string {
    const tasks = database.getTasksByProject(projectId);
    const overdue = database.getOverdueTasks(projectId);

    let snapshot = `## Current Board State\n`;
    snapshot += `Total open tasks: ${tasks.length}\n`;
    snapshot += `Overdue: ${overdue.length}\n\n`;

    const byStatus: Record<string, typeof tasks> = {};
    for (const t of tasks) {
      (byStatus[t.status] ??= []).push(t);
    }

    for (const [status, items] of Object.entries(byStatus)) {
      snapshot += `### ${status.toUpperCase()} (${items.length})\n`;
      for (const t of items.slice(0, 10)) {
        const assignee = t.assignedTo ? (database.findMemberById(t.assignedTo)?.name || 'Unassigned') : 'Unassigned';
        snapshot += `- #${t.displayId} "${t.title}" → ${assignee}`;
        if (t.deadline) snapshot += ` (due: ${t.deadline})`;
        snapshot += `\n`;
      }
    }

    return snapshot;
  }

  private getTeamContext(projectId: string): string {
    const members = database.getTeamMembers(projectId);

    let ctx = `## Team Members\n`;
    for (const m of members) {
      const taskCount = database.getTasksByAssignee(m.id).length;
      ctx += `- ${m.name} (phone: ${m.phoneNumber}) — ${taskCount} active tasks\n`;
    }

    return ctx;
  }
}

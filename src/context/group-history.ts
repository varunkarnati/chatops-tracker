import { NormalizedMessage } from '../tasks/models.js';

/**
 * Ring buffer of last N messages per group — keeps conversation context
 * for the LLM to understand reply chains and pronouns like "it", "that", etc.
 */
export class GroupHistory {
  private history: Map<string, Array<{ sender: string; text: string; timestamp: number }>> = new Map();
  private maxMessages: number;

  constructor(maxMessages: number = 20) {
    this.maxMessages = maxMessages;
  }

  add(groupId: string, sender: string, text: string, timestamp: number) {
    if (!this.history.has(groupId)) this.history.set(groupId, []);
    const arr = this.history.get(groupId)!;
    arr.push({ sender, text, timestamp });
    if (arr.length > this.maxMessages) arr.shift();
  }

  getContext(groupId: string): string {
    const msgs = this.history.get(groupId) || [];
    if (msgs.length === 0) return '';

    let ctx = `## Recent Group Messages (last ${msgs.length})\n`;
    for (const m of msgs) {
      ctx += `[${m.sender}]: ${m.text}\n`;
    }
    return ctx;
  }

  clear(groupId: string) {
    this.history.delete(groupId);
  }
}

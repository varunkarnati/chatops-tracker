import { database } from '../db/database.js';

/**
 * GroupHistory — persistent conversation memory per WhatsApp group.
 *
 * Previously an in-memory ring buffer that was lost on restart.
 * Now backed by SQLite — the bot remembers conversations across restarts.
 *
 * Messages are stored in the group_messages table and queried
 * on demand for the LLM context window.
 */
export class GroupHistory {
  private maxMessages: number;

  constructor(maxMessages: number = 30) {
    this.maxMessages = maxMessages;
  }

  /**
   * Store a message in persistent history.
   */
  add(groupId: string, senderName: string, senderId: string, text: string, messageId?: string, quotedMessageId?: string, timestamp?: number) {
    const ts = timestamp || Math.floor(Date.now() / 1000);
    database.storeGroupMessage(groupId, senderName, senderId, text, messageId, quotedMessageId, ts);
  }

  /**
   * Get recent conversation context for LLM prompt injection.
   */
  getContext(groupId: string): string {
    const msgs = database.getRecentGroupMessages(groupId, this.maxMessages);
    if (msgs.length === 0) return '';

    let ctx = `## Recent Group Conversation (last ${msgs.length} messages)\n`;
    for (const m of msgs) {
      ctx += `[${m.senderName}]: ${m.text}\n`;
    }
    return ctx;
  }

  /**
   * Get raw messages (for thread resolution, etc.).
   */
  getRecentMessages(groupId: string, limit?: number) {
    return database.getRecentGroupMessages(groupId, limit || this.maxMessages);
  }
}

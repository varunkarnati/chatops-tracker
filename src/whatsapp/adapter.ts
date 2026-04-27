import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WAMessage,
  GroupMetadata,
  fetchLatestBaileysVersion,
  Browsers,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { config } from '../config.js';
import { NormalizedMessage } from '../tasks/models.js';
import { mkdirSync } from 'fs';

type MessageHandler = (msg: NormalizedMessage) => Promise<void>;

/**
 * LRU-style set for message deduplication.
 * WhatsApp/Baileys can redeliver messages on reconnect or history sync.
 */
class MessageDedup {
  private seen: Set<string> = new Set();
  private queue: string[] = [];
  private maxSize: number;

  constructor(maxSize: number = 500) {
    this.maxSize = maxSize;
  }

  isDuplicate(messageId: string): boolean {
    if (this.seen.has(messageId)) return true;
    this.seen.add(messageId);
    this.queue.push(messageId);
    if (this.queue.length > this.maxSize) {
      const evicted = this.queue.shift()!;
      this.seen.delete(evicted);
    }
    return false;
  }
}

export class WhatsAppAdapter {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private messageHandler: MessageHandler | null = null;
  private groupCache: Map<string, GroupMetadata> = new Map();
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private lastQr: string | null = null;
  private reconnectInFlight = false;
  private reconnectAttempts = 0;
  private dedup = new MessageDedup(500);

  async connect() {
    if (this.reconnectInFlight) return;
    this.reconnectInFlight = true;

    mkdirSync(config.sessionPath, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(config.sessionPath);
    const { version, isLatest } = await fetchLatestBaileysVersion();

    this.socket = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any,
      version,
      browser: Browsers.windows('Chrome'),
    });

    if (!isLatest) {
      console.log(`Using fallback WhatsApp Web version: ${version.join('.')}`);
    }

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && qr !== this.lastQr) {
        this.lastQr = qr;
        console.log('\nScan this QR with WhatsApp > Linked devices:\n');
        qrcode.generate(qr, { small: true });
      }

      if (connection === 'close') {
        this.reconnectInFlight = false;
        this.reconnectAttempts += 1;

        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const reasonLabel = getDisconnectReasonLabel(reason);
        const errMessage = (lastDisconnect?.error as Error | undefined)?.message || 'unknown';

        if (reason === DisconnectReason.loggedOut || reason === DisconnectReason.badSession) {
          console.log(`WhatsApp disconnected: ${reasonLabel}.`);
          console.log('Delete data/wa-session and re-scan QR.');
          return;
        }

        if (reason === DisconnectReason.connectionReplaced) {
          console.log('WhatsApp session replaced by another login. Not auto-reconnecting.');
          return;
        }

        // Repeated 405 generally indicates a stale/invalid handshake path for this auth state.
        if (reason === 405 && this.reconnectAttempts >= 3) {
          console.log(`WhatsApp disconnected repeatedly: ${reasonLabel} (${errMessage}).`);
          console.log('Recovery: stop app, delete data/wa-session, start again, and scan a fresh QR.');
          return;
        }

        console.log(`WhatsApp disconnected: ${reasonLabel} (${errMessage}). Reconnecting in 3 seconds...`);

        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }

        this.reconnectTimeout = setTimeout(() => {
          this.reconnectTimeout = null;
          this.connect().catch((error) => {
            this.reconnectInFlight = false;
            console.error('Reconnect failed:', error);
          });
        }, 3000);
      }

      if (connection === 'open') {
        this.reconnectInFlight = false;
        this.reconnectAttempts = 0;
        this.lastQr = null;

        if (this.reconnectTimeout) {
          clearTimeout(this.reconnectTimeout);
          this.reconnectTimeout = null;
        }

        console.log('WhatsApp connected.');
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const groupId = msg.key.remoteJid;
        if (!groupId?.endsWith('@g.us')) continue;

        if (config.allowedGroups.length > 0 && !config.allowedGroups.includes(groupId)) {
          continue;
        }

        // Deduplication — skip messages we've already processed
        const msgId = msg.key.id;
        if (msgId && this.dedup.isDuplicate(msgId)) {
          continue;
        }

        const normalized = await this.normalizeMessage(msg, groupId);
        if (normalized && this.messageHandler) {
          // Wrap handler in try-catch so one bad message doesn't break the loop
          try {
            await this.messageHandler(normalized);
          } catch (error) {
            console.error(`Error processing message ${normalized.id}:`, error);
          }
        }
      }
    });
  }

  onMessage(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  /**
   * Send a text message to a group and return the sent message ID.
   * The message ID is used by ThreadTracker to link bot replies to tasks.
   */
  async sendToGroup(groupId: string, text: string): Promise<string | undefined> {
    if (!this.socket) throw new Error('WhatsApp not connected');
    
    // Auto-detect QuickChart URLs and send as image
    if (text.includes('https://quickchart.io/chart?c=')) {
      const url = text.split('\n').find(l => l.startsWith('https://quickchart.io/chart?c=')) || text;
      const caption = text.replace(url, '').trim();
      const sentMsg = await this.socket.sendMessage(groupId, { 
        image: { url }, 
        caption: caption || 'Dashboard Chart' 
      });
      return sentMsg?.key?.id || undefined;
    }

    const sentMsg = await this.socket.sendMessage(groupId, { text });
    return sentMsg?.key?.id || undefined;
  }

  async sendDM(jid: string, text: string) {
    if (!this.socket) throw new Error('WhatsApp not connected');
    await this.socket.sendMessage(jid, { text });
  }

  /**
   * Disconnect cleanly — called during graceful shutdown.
   */
  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.socket) {
      this.socket.end(undefined);
      this.socket = null;
    }
  }

  private async normalizeMessage(msg: WAMessage, groupId: string): Promise<NormalizedMessage | null> {
    const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
    if (!text) return null;

    const mentions = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    let groupMeta = this.groupCache.get(groupId);
    if (!groupMeta && this.socket) {
      try {
        groupMeta = await this.socket.groupMetadata(groupId);
        this.groupCache.set(groupId, groupMeta);
      } catch {
        // Ignore metadata lookup errors.
      }
    }

    return {
      id: msg.key.id || '',
      groupId,
      groupName: groupMeta?.subject || 'Unknown Group',
      senderId: msg.key.participant || msg.key.remoteJid || '',
      senderName: msg.pushName || 'Unknown',
      text,
      mentions: mentions.map((m) => m.replace('@s.whatsapp.net', '')),
      quotedMessage: quoted
        ? {
            id: msg.message?.extendedTextMessage?.contextInfo?.stanzaId || '',
            text: quoted.conversation || quoted.extendedTextMessage?.text || '',
            senderId: msg.message?.extendedTextMessage?.contextInfo?.participant || '',
          }
        : undefined,
      timestamp: msg.messageTimestamp as number,
    };
  }
}

function getDisconnectReasonLabel(reason?: number): string {
  if (reason === undefined) return 'unknown';

  switch (reason) {
    case DisconnectReason.badSession:
      return `bad_session (${reason})`;
    case DisconnectReason.connectionClosed:
      return `connection_closed (${reason})`;
    case DisconnectReason.connectionLost:
      return `connection_lost (${reason})`;
    case DisconnectReason.connectionReplaced:
      return `connection_replaced (${reason})`;
    case DisconnectReason.loggedOut:
      return `logged_out (${reason})`;
    case DisconnectReason.restartRequired:
      return `restart_required (${reason})`;
    case DisconnectReason.timedOut:
      return `timed_out (${reason})`;
    case DisconnectReason.multideviceMismatch:
      return `multidevice_mismatch (${reason})`;
    default:
      return `code_${reason}`;
  }
}

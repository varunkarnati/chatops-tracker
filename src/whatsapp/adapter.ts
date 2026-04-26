import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  WAMessage,
  GroupMetadata,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import { config } from '../config.js';
import { NormalizedMessage } from '../tasks/models.js';
import { mkdirSync } from 'fs';

type MessageHandler = (msg: NormalizedMessage) => Promise<void>;

export class WhatsAppAdapter {
  private socket: ReturnType<typeof makeWASocket> | null = null;
  private messageHandler: MessageHandler | null = null;
  private groupCache: Map<string, GroupMetadata> = new Map();

  async connect() {
    mkdirSync(config.sessionPath, { recursive: true });

    const { state, saveCreds } = await useMultiFileAuthState(config.sessionPath);

    this.socket = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }) as any,
      printQRInTerminal: true, // Scan this QR with your WhatsApp!
    });

    this.socket.ev.on('creds.update', saveCreds);

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;
        if (reason !== DisconnectReason.loggedOut) {
          console.log('🔄 Reconnecting...');
          this.connect();
        } else {
          console.log('❌ Logged out. Delete session and re-scan QR.');
        }
      } else if (connection === 'open') {
        console.log('✅ WhatsApp connected!');
      }
    });

    this.socket.ev.on('messages.upsert', async ({ messages }) => {
      for (const msg of messages) {
        if (!msg.message || msg.key.fromMe) continue;

        const groupId = msg.key.remoteJid;
        if (!groupId?.endsWith('@g.us')) continue; // Only group messages

        // Check if this group is allowed
        if (config.allowedGroups.length > 0 && !config.allowedGroups.includes(groupId)) {
          continue;
        }

        const normalized = await this.normalizeMessage(msg, groupId);
        if (normalized && this.messageHandler) {
          await this.messageHandler(normalized);
        }
      }
    });
  }

  onMessage(handler: MessageHandler) {
    this.messageHandler = handler;
  }

  async sendToGroup(groupId: string, text: string) {
    if (!this.socket) throw new Error('WhatsApp not connected');
    await this.socket.sendMessage(groupId, { text });
  }

  async sendDM(jid: string, text: string) {
    if (!this.socket) throw new Error('WhatsApp not connected');
    await this.socket.sendMessage(jid, { text });
  }

  private async normalizeMessage(msg: WAMessage, groupId: string): Promise<NormalizedMessage | null> {
    const text =
      msg.message?.conversation ||
      msg.message?.extendedTextMessage?.text ||
      '';

    if (!text) return null;

    const mentions =
      msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];

    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    // Get group metadata (cached)
    let groupMeta = this.groupCache.get(groupId);
    if (!groupMeta && this.socket) {
      try {
        groupMeta = await this.socket.groupMetadata(groupId);
        this.groupCache.set(groupId, groupMeta);
      } catch { /* ignore */ }
    }

    return {
      id: msg.key.id || '',
      groupId,
      groupName: groupMeta?.subject || 'Unknown Group',
      senderId: msg.key.participant || msg.key.remoteJid || '',
      senderName: msg.pushName || 'Unknown',
      text,
      mentions: mentions.map(m => m.replace('@s.whatsapp.net', '')),
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

import jwt from 'jsonwebtoken';
import { randomInt } from 'crypto';
import { WhatsAppAdapter } from '../whatsapp/adapter.js';
import { database } from '../db/database.js';
import { config } from '../config.js';

interface PendingOTP {
  code: string;
  phone: string;
  expiresAt: number;
  attempts: number;
}

/**
 * DashboardAuth — WhatsApp OTP-based authentication for the web dashboard.
 * No passwords needed — identity is proven by receiving a code on WhatsApp.
 */
export class DashboardAuth {
  private pendingCodes: Map<string, PendingOTP> = new Map();
  private readonly OTP_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ATTEMPTS = 3;

  constructor(
    private adapter: WhatsAppAdapter,
  ) {}

  async requestCode(phone: string): Promise<{ success: boolean; error?: string }> {
    const normalized = phone.replace(/[^\d+]/g, '');

    const member = database.findMemberByPhone(normalized);
    if (!member) {
      // Don't reveal whether the number is registered (security)
      return { success: true };
    }

    // Rate limit: max 1 code per 60 seconds
    const existing = this.pendingCodes.get(normalized);
    if (existing && existing.expiresAt - this.OTP_TTL + 60000 > Date.now()) {
      return { success: false, error: 'Please wait 60 seconds before requesting a new code' };
    }

    const code = String(randomInt(100000, 999999));
    this.pendingCodes.set(normalized, {
      code, phone: normalized,
      expiresAt: Date.now() + this.OTP_TTL,
      attempts: 0,
    });

    const waJid = `${normalized}@s.whatsapp.net`;
    await this.adapter.sendDM(waJid,
      `🔐 *Dashboard Login Code*\n\n` +
      `Your code: *${code}*\n\n` +
      `Expires in 5 minutes.\n` +
      `If you didn't request this, ignore this message.`
    );

    return { success: true };
  }

  verifyCode(phone: string, code: string): { token?: string; member?: any; error?: string } {
    const normalized = phone.replace(/[^\d+]/g, '');
    const pending = this.pendingCodes.get(normalized);

    if (!pending || pending.expiresAt < Date.now()) {
      return { error: 'Code expired or not found. Request a new one.' };
    }

    if (pending.attempts >= this.MAX_ATTEMPTS) {
      this.pendingCodes.delete(normalized);
      return { error: 'Too many attempts. Request a new code.' };
    }

    if (pending.code !== code) {
      pending.attempts++;
      return { error: `Invalid code. ${this.MAX_ATTEMPTS - pending.attempts} attempts remaining.` };
    }

    this.pendingCodes.delete(normalized);

    const member = database.findMemberByPhone(normalized);
    if (!member) return { error: 'Member not found.' };

    const token = jwt.sign(
      { memberId: member.id, phone: normalized, role: member.role, projectId: member.projectId },
      config.jwtSecret,
      { expiresIn: '7d' }
    );

    return { token, member: { name: member.name, role: member.role } };
  }

  verifyToken(token: string): { memberId: string; phone: string; role: string; projectId: string } | null {
    try {
      return jwt.verify(token, config.jwtSecret) as any;
    } catch {
      return null;
    }
  }
}

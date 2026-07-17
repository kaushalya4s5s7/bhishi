import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { PrismaService } from '../prisma/prisma.service';

export interface CircleInviteEmail {
  to: string;
  circleAddress: string;
  inviteUrl: string;
  /** Inviter's wallet address, shown in the email body for context. */
  inviter: string;
}

/**
 * Sends transactional email via Resend. When RESEND_API_KEY is unset (local
 * dev), it logs the email that WOULD have been sent instead of failing — so the
 * whole invite flow works end-to-end with no external dependency. Every attempt
 * is recorded in NotificationLog for audit/dedup, matching the notify worker.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const key = this.config.get<string>('RESEND_API_KEY');
    this.resend = key ? new Resend(key) : null;
    this.from = this.config.get<string>('EMAIL_FROM') ?? 'Bhishi <onboarding@resend.dev>';
  }

  async sendCircleInvite(email: CircleInviteEmail): Promise<void> {
    const subject = 'You’re invited to a Bhishi savings circle';
    const html = this.renderHtml(email);
    const text =
      `You've been invited to join a Bhishi circle.\n\n` +
      `Open this link to join: ${email.inviteUrl}\n\n` +
      `Circle: ${email.circleAddress}\nInvited by: ${email.inviter}`;

    let status = 'sent';
    let errorMsg: string | undefined;
    try {
      if (this.resend) {
        await this.resend.emails.send({ from: this.from, to: email.to, subject, html, text });
      } else {
        this.logger.log(`[email:fallback] to=${email.to} url=${email.inviteUrl}`);
        // eslint-disable-next-line no-console
        console.log(`\n--- INVITE EMAIL (no RESEND_API_KEY) ---\nTo: ${email.to}\n${text}\n---\n`);
      }
    } catch (e) {
      status = 'failed';
      errorMsg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Failed to send invite to ${email.to}: ${errorMsg}`);
    }

    await this.prisma.notificationLog.create({
      data: {
        email: email.to,
        channel: 'email',
        kind: 'circle_invite',
        status,
        error: errorMsg ?? null,
        sentAt: status === 'sent' ? new Date() : null,
      },
    });
  }

  private renderHtml(email: CircleInviteEmail): string {
    return `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>You’re invited to a Bhishi circle</h2>
        <p>Someone invited you to join a rotating savings circle on Bhishi.</p>
        <p><a href="${email.inviteUrl}" style="display:inline-block;padding:12px 20px;background:#0b0b0e;color:#faf9f6;text-decoration:none;border-radius:4px;">Join the circle</a></p>
        <p style="color:#6b6470;font-size:12px;">Or paste this link: ${email.inviteUrl}</p>
        <p style="color:#6b6470;font-size:12px;">Circle: ${email.circleAddress}</p>
      </div>`;
  }
}

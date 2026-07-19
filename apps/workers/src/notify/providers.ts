import webpush from 'web-push';
import { prisma } from '@bhishi/db';
import { logger, config } from '../config.js';

export interface SendResult {
  ok: boolean;
  error?: string;
}

export interface NotifyProvider {
  readonly name: string;
  send(to: string, subject: string, body: string): Promise<SendResult>;
}

/**
 * Default driver: logs instead of sending.
 *
 * This is deliberately the fallback rather than a hard failure — the whole
 * notify pipeline (queue, retries, dedupe, audit log) is exercisable without
 * Twilio/Meta/Resend credentials, and swapping in a real provider is a config
 * change, not a code change. It is obviously NOT delivery: nothing reaches a
 * human. `notifyReady()` reports which channels are actually live so this can
 * never be mistaken for a working integration in production.
 */
class LogProvider implements NotifyProvider {
  constructor(readonly name: string) {}
  async send(to: string, subject: string, body: string): Promise<SendResult> {
    logger.warn({ provider: this.name, to, subject, body }, 'NOT DELIVERED — no provider configured; logging only');
    return { ok: true };
  }
}

/**
 * Email via Resend. Uses fetch directly rather than the SDK to avoid a
 * dependency for one endpoint.
 */
class ResendProvider implements NotifyProvider {
  readonly name = 'resend';
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(to: string, subject: string, body: string): Promise<SendResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: this.from, to, subject, text: body }),
      });
      if (!res.ok) return { ok: false, error: `resend ${res.status}: ${await res.text()}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

/**
 * Email via SendGrid. Uses fetch directly for the same reason as Resend.
 *
 * SendGrid's Single Sender Verification (verify one address via email link)
 * needs no DNS records, unlike full domain auth — the option that actually
 * works when the app only has a *.up.railway.app subdomain, which nobody
 * controls DNS for.
 */
class SendGridProvider implements NotifyProvider {
  readonly name = 'sendgrid';
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async send(to: string, subject: string, body: string): Promise<SendResult> {
    try {
      const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: to }] }],
          from: { email: this.from },
          subject,
          content: [{ type: 'text/plain', value: body }],
        }),
      });
      if (!res.ok) return { ok: false, error: `sendgrid ${res.status}: ${await res.text()}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

/** WhatsApp via Twilio's messaging API. */
class TwilioWhatsAppProvider implements NotifyProvider {
  readonly name = 'twilio-whatsapp';
  constructor(
    private readonly sid: string,
    private readonly token: string,
    private readonly from: string,
  ) {}

  async send(to: string, _subject: string, body: string): Promise<SendResult> {
    try {
      const url = `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`;
      const form = new URLSearchParams({
        From: `whatsapp:${this.from}`,
        To: `whatsapp:${to}`,
        Body: body,
      });
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(`${this.sid}:${this.token}`).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
      });
      if (!res.ok) return { ok: false, error: `twilio ${res.status}: ${await res.text()}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

/**
 * Web Push, routed by wallet address rather than by device — `to` is the
 * lowercased wallet (same routing key as email/WhatsApp today), and the
 * provider fans out to every `PushSubscription` row for that wallet. A dead
 * subscription (404/410 from the push service) is pruned so we stop paying
 * for retries against it; that's not treated as an overall send failure as
 * long as at least one other subscription for the wallet succeeded.
 */
class WebPushProvider implements NotifyProvider {
  readonly name = 'webpush';
  constructor() {
    webpush.setVapidDetails(config.vapidSubject, config.vapidPublic, config.vapidPrivate);
  }

  async send(to: string, subject: string, body: string): Promise<SendResult> {
    const subs = await prisma.pushSubscription.findMany({ where: { walletAddress: to.toLowerCase() } });
    if (subs.length === 0) return { ok: false, error: 'no push subscription for wallet' };

    const payload = JSON.stringify({ title: subject, body, url: '/dashboard' });
    let anyOk = false;
    for (const s of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        anyOk = true;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 = subscription gone; prune it so we stop trying.
        if (status === 404 || status === 410) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
        }
      }
    }
    return anyOk ? { ok: true } : { ok: false, error: 'all push sends failed' };
  }
}

/**
 * Selected once at import from env; falls back to the log driver.
 * SendGrid takes priority when configured — Resend requires DNS-based domain
 * verification, which is unreachable while the app lives on a
 * *.up.railway.app subdomain we don't control DNS for.
 */
export const emailProvider: NotifyProvider = process.env.SENDGRID_API_KEY
  ? new SendGridProvider(process.env.SENDGRID_API_KEY, process.env.SENDGRID_FROM ?? 'noreply@bhishi.app')
  : process.env.RESEND_API_KEY
    ? new ResendProvider(process.env.RESEND_API_KEY, process.env.RESEND_FROM ?? 'noreply@bhishi.app')
    : new LogProvider('email(log)');

export const whatsappProvider: NotifyProvider =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM
    ? new TwilioWhatsAppProvider(
        process.env.TWILIO_ACCOUNT_SID,
        process.env.TWILIO_AUTH_TOKEN,
        process.env.TWILIO_WHATSAPP_FROM,
      )
    : new LogProvider('whatsapp(log)');

export const pushProvider: NotifyProvider =
  config.vapidPublic && config.vapidPrivate ? new WebPushProvider() : new LogProvider('webpush(log)');

/** Which channels are genuinely wired — surfaced at boot and via /health. */
export function notifyReady() {
  return {
    email: emailProvider.name !== 'email(log)',
    whatsapp: whatsappProvider.name !== 'whatsapp(log)',
    webpush: pushProvider.name !== 'webpush(log)',
  };
}

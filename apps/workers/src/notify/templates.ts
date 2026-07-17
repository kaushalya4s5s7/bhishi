import type { NotifyJob, NotifyKind } from '../queues.js';

function short(addr: unknown): string {
  const s = String(addr ?? '');
  return s.length > 10 ? `${s.slice(0, 6)}…${s.slice(-4)}` : s;
}

/** mUSDC has 6 decimals; amounts arrive as base-unit strings. */
function usdc(v: unknown): string {
  const n = Number(v ?? 0) / 1e6;
  return `${n.toFixed(2)} mUSDC`;
}

export interface Rendered {
  subject: string;
  body: string;
}

const RENDERERS: Record<NotifyKind, (v: Record<string, unknown>) => Rendered> = {
  waitlist_welcome: () => ({
    subject: 'You’re on the Bhishi early-access list',
    body:
      'Thanks for signing up to Bhishi — a savings circle where nobody holds your money.\n\n' +
      'We’ll email you as soon as your spot opens up.',
  }),

  round_deadline_reminder: (v) => ({
    subject: `Reminder: your Bhishi ${String(v.phase ?? 'round')} closes soon`,
    body:
      `Your circle ${short(v.circle)} is in the ${String(v.phase ?? 'current')} phase for round ${v.round ?? '?'}.\n\n` +
      `You have about ${v.hoursLeft ?? 6} hours left to act. If you miss the deadline, ` +
      `your bond can be slashed — so please open the app and complete this round.`,
  }),

  payout_received: (v) => ({
    subject: 'You won this round of your Bhishi circle 🎉',
    body:
      `You were drawn as the winner of round ${v.round ?? '?'} in circle ${short(v.circle)}.\n\n` +
      `${usdc(v.amount)} is ready to claim in the app.`,
  }),

  slash_notice: (v) => ({
    subject: 'Your Bhishi bond was slashed',
    body:
      `You missed the reveal deadline for round ${v.round ?? '?'} in circle ${short(v.circle)}, ` +
      `so ${usdc(v.amount)} of your bond was used to keep the round whole for everyone else.\n\n` +
      `This is automatic and enforced by the contract — no organizer decided it.`,
  }),
};

export function render(job: NotifyJob): Rendered {
  return RENDERERS[job.kind](job.vars ?? {});
}

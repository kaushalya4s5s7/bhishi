/* Shared UI primitives — the ink/brass/ledger vocabulary, in one place so every
   screen looks like the same product. Keep decoration here; pages stay quiet. */
import Link from 'next/link';
import type { ReactNode } from 'react';

/** Mono uppercase brass label above a heading (from the landing hero). */
export function Eyebrow({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <p className={`eyebrow ${muted ? 'eyebrow-muted' : ''}`}>{children}</p>;
}

/** Dashed ledger rule — the accounting-book divider. */
export function LedgerRule({ className = '' }: { className?: string }) {
  return <div className={`ledger-rule text-[#6b6470] ${className}`} aria-hidden />;
}

/** A labelled section divider: EYEBROW ————————— */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-4 mb-5">
      <span className="eyebrow eyebrow-muted whitespace-nowrap">{children}</span>
      <LedgerRule className="flex-1" />
    </div>
  );
}

/** The circle seal mark — the brand coin. */
export function Seal({ size = 30 }: { size?: number }) {
  return (
    <span
      className="inline-grid place-items-center rounded-full border-[1.5px] border-[#0b0b0e] font-display font-bold"
      style={{ width: size, height: size, fontSize: size * 0.5 }}
      aria-hidden
    >
      B
    </span>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: 'solid' | 'ghost' | 'brass';
  disabled?: boolean;
  type?: 'button' | 'submit';
  full?: boolean;
  className?: string;
};

/** The one button. Solid ink by default; ghost outline; brass for the money action. */
export function Button({
  children, onClick, href, variant = 'solid', disabled, type = 'button', full, className = '',
}: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-2 rounded-sm font-semibold text-sm px-5 py-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
  const variants = {
    solid: 'bg-[#0b0b0e] text-[#faf9f6] hover:bg-[#26242b]',
    ghost: 'border border-[#0b0b0e] text-[#0b0b0e] hover:bg-[#0b0b0e] hover:text-[#faf9f6]',
    brass: 'bg-[#c9a15c] text-[#0b0b0e] hover:bg-[#b8924f]',
  };
  const cls = `${base} ${variants[variant]} ${full ? 'w-full' : ''} ${className}`;
  if (href && !disabled) return <Link href={href} className={cls}>{children}</Link>;
  return <button type={type} onClick={onClick} disabled={disabled} className={cls}>{children}</button>;
}

/** A paper card with the signature brass left-edge accent. */
export function Card({ children, className = '', accent = true }: { children: ReactNode; className?: string; accent?: boolean }) {
  return (
    <div
      className={`relative overflow-hidden rounded-sm border border-[#e6e2d9] bg-white ${className}`}
    >
      {accent && <span className="absolute left-0 top-0 h-full w-[3px] bg-[#c9a15c]" aria-hidden />}
      {children}
    </div>
  );
}

const PHASE_STYLES: Record<string, { label: string; cls: string }> = {
  FILLING:  { label: 'Filling',   cls: 'bg-[#f0ead8] text-[#8a6d2f]' },
  COMMIT:   { label: 'Commit',    cls: 'bg-[#f0ead8] text-[#8a6d2f]' },
  REVEAL:   { label: 'Reveal',    cls: 'bg-[#f0ead8] text-[#8a6d2f]' },
  DRAW:     { label: 'Drawing',   cls: 'bg-[#e8ecf0] text-[#3a5a7a]' },
  COMPLETED:{ label: 'Completed', cls: 'bg-[#e6efe8] text-[#3a6d4a]' },
  STALLED:  { label: 'Stalled',   cls: 'bg-[#f3e3e0] text-[#9a4a3a]' },
  ABORTED:  { label: 'Aborted',   cls: 'bg-[#f3e3e0] text-[#9a4a3a]' },
};

/** Phase chip — mono, uppercase, colour-coded by lifecycle stage. */
export function PhaseBadge({ phase }: { phase: string }) {
  const s = PHASE_STYLES[phase] ?? { label: phase, cls: 'bg-[#efece5] text-[#6b6470]' };
  return (
    <span className={`font-mono text-[10px] tracking-[0.12em] uppercase px-2.5 py-1.5 rounded-sm ${s.cls}`}>
      {s.label}
    </span>
  );
}

/**
 * The SIGNATURE element: the ledger seat-ring. Each seat is a coin-slot that
 * fills with a brass wax-seal ✓ as members join — the real thing a chit fund
 * tracks. `filled` of `total` seats occupied.
 */
export function SeatRing({ filled, total }: { filled: number; total: number }) {
  return (
    <div className="flex gap-1.5 flex-wrap" aria-label={`${filled} of ${total} seats filled`}>
      {Array.from({ length: total }).map((_, i) => {
        const on = i < filled;
        return (
          <span
            key={i}
            className={`grid place-items-center rounded-full text-[11px] font-semibold border-[1.5px] transition-colors ${
              on
                ? 'bg-[#0b0b0e] border-[#0b0b0e] text-[#faf9f6]'
                : 'border-[#e6e2d9] text-[#c3bdb0]'
            }`}
            style={{ width: 26, height: 26 }}
          >
            {on ? '✓' : i + 1}
          </span>
        );
      })}
    </div>
  );
}

/** Short 0x truncation used everywhere. */
export function truncate(addr?: string) {
  if (!addr) return '';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

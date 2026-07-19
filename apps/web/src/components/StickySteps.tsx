'use client';
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useRef } from 'react';

const STEPS = [
  {
    title: 'Join a circle',
    desc: 'Set how much everyone pays in and how many people can join. Everyone puts down a small deposit to show they’re serious.',
  },
  {
    title: 'Pay in each round',
    desc: 'Every round, your payment is locked in secretly first, then revealed for everyone to see — so no one can peek at what others are paying and change their move.',
  },
  {
    title: 'A random draw picks the winner',
    desc: 'Pyth Entropy — an outside, tamper-proof source of randomness — picks who gets paid each round. Anyone can check the result on-chain. No one, including us, chooses the winner.',
  },
];

function StepDot({ index, progress }: { index: number; progress: MotionValue<number> }) {
  const scale = useTransform(progress, [index - 0.5, index, index + 0.5], [0.6, 1, 0.6]);
  const opacity = useTransform(progress, [index - 0.5, index, index + 0.5], [0.35, 1, 0.35]);
  return <motion.span style={{ scale, opacity }} className="block w-2 h-2 rounded-full bg-[#c9a15c]" />;
}

/** Step 1 preview: seats filling up as members join. */
function JoinPreview() {
  const seats = [true, true, true, false, false];
  return (
    <div className="bg-[#151318] border border-white/10 p-6 w-full max-w-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/50 uppercase tracking-[0.15em]">Circle seats</p>
        <span className="font-mono text-xs text-white/50">3 / 5</span>
      </div>
      <div className="mt-4 flex gap-2">
        {seats.map((filled, i) => (
          <span
            key={i}
            className={`h-9 flex-1 border ${filled ? 'bg-[#c9a15c] border-[#c9a15c]' : 'border-white/15'}`}
          />
        ))}
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
        <span className="text-xs text-white/50">Deposit to join</span>
        <span className="font-display text-lg font-semibold text-white">20 USDC</span>
      </div>
    </div>
  );
}

/** Step 2 preview: a sealed commit resolving into a revealed contribution. */
function CommitRevealPreview() {
  return (
    <div className="bg-[#151318] border border-white/10 p-6 w-full max-w-sm">
      <p className="text-xs text-white/50 uppercase tracking-[0.15em]">This round</p>
      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1 bg-white/5 border border-white/10 px-4 py-3 text-center">
          <p className="text-[10px] text-white/40 uppercase tracking-[0.1em] mb-1">Sealed</p>
          <p className="font-mono text-sm text-white/70">••••••</p>
        </div>
        <span className="text-white/30 font-mono text-xs">→</span>
        <div className="flex-1 bg-[#c9a15c]/15 border border-[#c9a15c]/40 px-4 py-3 text-center">
          <p className="text-[10px] text-[#c9a15c] uppercase tracking-[0.1em] mb-1">Revealed</p>
          <p className="font-display text-sm font-semibold text-white">1,000 USDC</p>
        </div>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
        <span className="text-xs text-white/50">Members revealed</span>
        <span className="font-mono text-xs text-white/50">5 / 5</span>
      </div>
    </div>
  );
}

/** Step 3 preview: the draw resolving to a winner and payout. */
function DrawPreview() {
  return (
    <div className="bg-[#151318] border border-white/10 p-6 w-full max-w-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs text-white/50 uppercase tracking-[0.15em]">Pyth Entropy draw</p>
        <span className="font-mono text-xs text-[#c9a15c]">verified</span>
      </div>
      <div className="mt-4 bg-[#c9a15c] px-4 py-4 flex items-center justify-between">
        <div>
          <p className="text-[10px] text-[#0b0b0e]/60 uppercase tracking-[0.1em] mb-1">Winner</p>
          <p className="font-display text-sm font-semibold text-[#0b0b0e]">0x9f2…c41a</p>
        </div>
        <span className="font-display text-lg font-semibold text-[#0b0b0e]">12,000 USDC</span>
      </div>
      <div className="mt-5 flex items-center justify-between border-t border-white/10 pt-4">
        <span className="text-xs text-white/50">Settled</span>
        <span className="font-mono text-xs text-white/50">automatically</span>
      </div>
    </div>
  );
}

const PREVIEWS = [JoinPreview, CommitRevealPreview, DrawPreview];

function StepPanel({ step, index, progress }: { step: (typeof STEPS)[number]; index: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [index - 0.4, index, index + 0.4], [0, 1, 0]);
  const y = useTransform(progress, [index - 1, index], [24, 0]);
  const Preview = PREVIEWS[index];
  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0 grid grid-cols-1 md:grid-cols-2 gap-10 items-center">
      <div>
        <p className="font-mono text-xs font-medium tracking-[0.2em] text-[#c9a15c] uppercase mb-3">
          {String(index + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
        </p>
        <h3 className="font-display font-semibold text-2xl sm:text-3xl text-white mb-3">{step.title}</h3>
        <p className="text-white/50 text-base leading-relaxed max-w-md">{step.desc}</p>
      </div>
      <div className="hidden md:flex justify-center">
        <Preview />
      </div>
    </motion.div>
  );
}

export function StickySteps() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  const activeIndex = useTransform(scrollYProgress, [0, 1], [0, STEPS.length - 1]);

  return (
    <div ref={ref} className="relative" style={{ height: `${STEPS.length * 70}vh` }}>
      <div className="sticky top-16 h-[calc(100vh-4rem)] flex items-center">
        <div className="max-w-6xl mx-auto px-6 w-full grid grid-cols-1 md:grid-cols-[auto_1fr] gap-10 md:gap-16 items-center">
          <div className="hidden md:flex flex-col gap-6 items-center">
            {STEPS.map((_, i) => (
              <StepDot key={i} index={i} progress={activeIndex} />
            ))}
          </div>

          <div className="relative h-72 md:h-64">
            {STEPS.map((step, i) => (
              <StepPanel key={step.title} step={step} index={i} progress={activeIndex} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

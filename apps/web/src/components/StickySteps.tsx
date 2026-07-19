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

function StepPanel({ step, index, progress }: { step: (typeof STEPS)[number]; index: number; progress: MotionValue<number> }) {
  const opacity = useTransform(progress, [index - 0.4, index, index + 0.4], [0, 1, 0]);
  const y = useTransform(progress, [index - 1, index], [24, 0]);
  return (
    <motion.div style={{ opacity, y }} className="absolute inset-0 flex flex-col justify-center">
      <p className="font-mono text-xs font-medium tracking-[0.2em] text-[#c9a15c] uppercase mb-3">
        {String(index + 1).padStart(2, '0')} / {String(STEPS.length).padStart(2, '0')}
      </p>
      <h3 className="font-display font-semibold text-2xl sm:text-3xl text-white mb-3">{step.title}</h3>
      <p className="text-white/50 text-base leading-relaxed max-w-md">{step.desc}</p>
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

          <div className="relative h-56">
            {STEPS.map((step, i) => (
              <StepPanel key={step.title} step={step} index={i} progress={activeIndex} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

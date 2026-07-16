'use client';
import { motion, useScroll, useTransform, type MotionValue } from 'framer-motion';
import { useRef } from 'react';

const STEPS = [
  {
    title: 'Join a circle',
    desc: 'Set a contribution amount and seats. Everyone locks a bond to guarantee participation.',
  },
  {
    title: 'Contribute each round',
    desc: 'Commit & reveal your contribution every cycle, privately and on-chain.',
  },
  {
    title: 'VRF picks the winner',
    desc: 'Verifiable randomness decides the payout each round — provably fair, no exceptions.',
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

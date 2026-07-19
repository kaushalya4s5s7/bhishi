import Link from 'next/link';
import Image from 'next/image';
import { StickySteps } from '@/components/StickySteps';
import { Marquee } from '@/components/Marquee';
import { Reveal } from '@/components/Reveal';
import { HeroCTAs } from '@/components/HeroCTAs';
import { SmoothScroll } from '@/components/SmoothScroll';
import { CommunityCarousel } from '@/components/CommunityCarousel';

const TRUST_ITEMS = [
  { label: 'No one holds your money' },
  { label: 'Winner picked by verifiable randomness' },
  { label: 'Backed by a security deposit' },
  { label: 'Built on Monad' },
  { label: 'Fully on-chain' },
  { label: 'Get your funds back anytime' },
];

export default function LandingPage() {
  return (
    <main className="relative bg-[#faf9f6]">
      <SmoothScroll />
      {/* Continuous vertical rails running the full height of the landing page,
          aligned to the mx-4 sm:mx-6 inset. The navbar carries matching rails at
          the same inset so the boundary is unbroken from the very top to the end. */}
      <div className="pointer-events-none absolute inset-y-0 left-4 sm:left-6 z-40 w-px bg-black/20" />
      <div className="pointer-events-none absolute inset-y-0 right-4 sm:right-6 z-40 w-px bg-black/20" />
      {/* Hero */}
      <section className="relative bg-[#faf9f6]">
        <div className="relative h-[60vh] min-h-[400px] sm:h-[63vh] sm:min-h-[400px] mx-4 sm:mx-6 overflow-hidden rounded-xl">
          <Image
            src="/image1.png"
            alt="A family gathers around a table, contributing coins to a shared savings pot."
            fill
            priority
            className="object-cover object-[50%_38%]"
          />
          <div
            className="absolute inset-0 opacity-15 mix-blend-overlay "
            style={{
              backgroundImage:
                'linear-gradient(to right, #fdf9f9 1px, transparent 1px), linear-gradient(to bottom, #000 1px, transparent 1px)',
              backgroundSize: '48px 48px',
            }}
          />
        </div>

        <div className="relative max-w-6xl mx-auto px-6 py-4 sm:py-20 grid grid-cols-1 lg:grid-cols-[1fr_auto] gap-10 items-end">
          <Reveal>
            <p className="font-mono text-xs tracking-[0.25em] uppercase text-[#c9a15c] mb-5">
              Onchain Bishi &middot; Built on Monad
            </p>
            <h1 className="font-display font-semibold text-4xl sm:text-6xl md:text-7xl leading-[1.02] text-[#0b0b0e] max-w-2xl text-balance">
              Save together.
              <br />
              Trust the math.
            </h1>
            <p className="mt-6 text-base sm:text-lg text-[#6b6470] max-w-lg leading-relaxed">
              The same chit-fund circle your family has run for generations — now secured by a
              smart contract instead of a person&apos;s word.
            </p>
            <HeroCTAs />
          </Reveal>

          <Reveal delay={0.1} className="lg:text-right">
            <p className="font-mono text-xs tracking-[0.2em] uppercase text-[#6b6470] mb-3">Built on</p>
            <p className="font-display text-lg font-semibold text-[#0b0b0e]">Monad &middot; Pyth Entropy</p>
          </Reveal>
        </div>
      </section>

      <div className="border-b border-black/5 bg-white py-5">
        <Marquee items={TRUST_ITEMS} />
      </div>

      {/* Sticky how-it-works */}
      <section id="how" className="bg-[#0b0b0e]">
        <StickySteps />
      </section>

      {/* Built for real trust */}
      <section id="trust" className="py-24 sm:py-28">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
          <Reveal>
            <p className="font-mono text-xs tracking-[0.2em] uppercase text-[#c9a15c] mb-4">Trust, enforced</p>
            <h2 className="font-display font-semibold text-3xl sm:text-4xl text-[#0b0b0e] leading-tight">
              Built for real trust,
              <br />
              not promises
            </h2>
            <p className="mt-5 text-[#6b6470] leading-relaxed max-w-md">
              Every rupee moves through a smart contract, not a person. Here&apos;s what protects
              you at every step.
            </p>
            <div className="mt-8 divide-y divide-black/10">
              {[
                'No organizer can touch your funds — ever',
                'Miss a payment and your deposit covers the group, so no one else loses out',
                'If the winner draw ever stalls, anyone can trigger a refund — your money is never stuck',
              ].map(item => (
                <div key={item} className="flex gap-4 items-start py-3.5 text-sm text-[#0b0b0e]">
                  <span className="mt-0.5 font-mono text-xs text-[#c9a15c] shrink-0">＋</span>
                  {item}
                </div>
              ))}
            </div>
          </Reveal>

          <Reveal delay={0.1} className="space-y-4">
            <div className="bg-white border border-black/10 p-6">
              <p className="text-xs font-medium text-[#6b6470] uppercase tracking-[0.15em] mb-4">
                Active Circle
              </p>
              <div className="bg-[#0b0b0e] px-5 py-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-white/50 mb-1">Round Pot</p>
                  <p className="text-white font-display text-2xl font-semibold">12,000 USDC</p>
                </div>
                <span className="font-mono text-xs text-white/50">Round 04/12</span>
              </div>
            </div>
            <div className="bg-white border border-black/10 p-6 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-[#6b6470] uppercase tracking-[0.15em] mb-1">Next Payout</p>
                <p className="font-display text-xl font-semibold text-[#0b0b0e]">2d 14h remaining</p>
              </div>
              <span className="w-11 h-11 border border-[#c9a15c]/40 text-[#c9a15c] flex items-center justify-center text-sm font-mono">
                ⏱
              </span>
            </div>
          </Reveal>
        </div>
      </section>

      <div className="ledger-rule max-w-6xl mx-auto text-[#0b0b0e]" />

      {/* Fairness section */}
      <section className="py-24 sm:py-28 bg-[#f4f1ea]">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
          <Reveal className="order-2 lg:order-1 bg-white border border-black/10 p-7">
            <p className="text-xs font-medium text-[#6b6470] uppercase tracking-[0.15em] mb-5">
              Your Contribution
            </p>
            <div className="flex items-center justify-between border border-black/10 px-4 py-3 mb-3">
              <span className="text-sm font-medium text-[#0b0b0e]">You pay</span>
              <span className="font-display text-lg font-semibold text-[#0b0b0e]">1,000 USDC</span>
            </div>
            <div className="flex justify-center -my-1">
              <span className="w-7 h-7 border border-[#0b0b0e] bg-[#faf9f6] text-[#0b0b0e] flex items-center justify-center text-xs font-mono">
                ↓
              </span>
            </div>
            <div className="flex items-center justify-between bg-[#0b0b0e] px-4 py-3 mt-3">
              <span className="text-sm font-medium text-white/50">Pot grows to</span>
              <span className="font-display text-lg font-semibold text-white">12,000 USDC</span>
            </div>
            <p className="mt-4 text-xs text-[#6b6470]">
              No transaction or admin fee for saving — 100% goes to the circle.
            </p>
          </Reveal>

          <Reveal delay={0.1} className="order-1 lg:order-2">
            <p className="font-mono text-xs tracking-[0.2em] uppercase text-[#c9a15c] mb-4">Provably fair</p>
            <h2 className="font-display font-semibold text-3xl sm:text-4xl text-[#0b0b0e] leading-tight">
              Provably fair payouts
            </h2>
            <p className="mt-5 text-[#6b6470] leading-relaxed max-w-md">
              We use Pyth Entropy, an outside randomness service, so every winner is picked by
              chance anyone can double-check — not a spreadsheet, not a person&apos;s word, not us.
            </p>
            <div className="mt-8 divide-y divide-black/10">
              {[
                'Anyone can verify the winner was picked fairly',
                'Payouts happen automatically the moment a round closes',
                'Your deposit is the only thing keeping the circle honest',
              ].map(item => (
                <div key={item} className="flex gap-4 items-start py-3.5 text-sm text-[#0b0b0e]">
                  <span className="mt-0.5 font-mono text-xs text-[#c9a15c] shrink-0">＋</span>
                  {item}
                </div>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* Track your circle */}
      <section className="py-24 sm:py-28">
        <div className="max-w-6xl mx-auto px-6 grid grid-cols-1 lg:grid-cols-2 gap-14 items-center">
          <Reveal>
            <p className="font-mono text-xs tracking-[0.2em] uppercase text-[#c9a15c] mb-4">Live ledger</p>
            <h2 className="font-display font-semibold text-3xl sm:text-4xl text-[#0b0b0e] leading-tight">
              Track your circle,
              <br />
              round by round
            </h2>
            <p className="mt-5 text-[#6b6470] leading-relaxed max-w-md">
              See exactly what you&apos;ve put in, what&apos;s coming out, and when — all pulled
              live from the chain, no spreadsheets required.
            </p>
            <div className="mt-7 flex gap-4">
              <div className="bg-white border border-black/10 px-5 py-4 flex-1">
                <p className="text-xs text-[#6b6470] mb-1">Total Saved</p>
                <p className="font-display text-lg font-semibold text-[#0b0b0e]">8,000 USDC</p>
              </div>
              <div className="bg-[#0b0b0e] px-5 py-4 flex-1">
                <p className="text-xs text-white/50 mb-1">Next Payout</p>
                <p className="font-display text-lg font-semibold text-white">12,000 USDC</p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={0.1} className="bg-white border border-black/10 p-6">
            <div className="flex items-center justify-between mb-6">
              <span className="text-sm font-semibold text-[#0b0b0e]">Rounds 1–8</span>
              <span className="font-mono text-xs text-[#6b6470] border border-black/10 px-3 py-1">Contributions</span>
            </div>
            <svg viewBox="0 0 320 140" className="w-full h-32">
              <polyline
                points="0,110 40,90 80,100 120,60 160,80 200,40 240,55 280,20 320,35"
                fill="none"
                stroke="#c9a15c"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points="0,130 40,120 80,125 120,115 160,110 200,100 240,95 280,90 320,80"
                fill="none"
                stroke="#d8d2c4"
                strokeWidth="2"
                strokeDasharray="4 5"
                strokeLinecap="round"
              />
            </svg>
            <div className="flex justify-between mt-2 font-mono text-[10px] text-[#6b6470]">
              {['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'].map(r => (
                <span key={r}>{r}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      <CommunityCarousel />

      {/* CTA */}
      <section className="py-20 sm:py-24">
        <div className="max-w-4xl mx-auto px-6">
          <Reveal className="bg-[#0b0b0e] px-8 py-16 text-center">
            <h2 className="font-display font-semibold text-3xl sm:text-4xl text-white leading-tight">
              Try Bhishi today
            </h2>
            <p className="mt-4 text-white/50 max-w-md mx-auto">
              Join a live circle in minutes, or get notified when new circles open.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-4 justify-center items-center">
              <Link
                href="/dashboard"
                className="bg-[#c9a15c] text-[#0b0b0e] font-semibold px-9 py-3.5 hover:bg-[#dbb877] transition"
              >
                Launch App
              </Link>
              <Link
                href="/early-access"
                className="border border-white/20 text-white font-semibold px-9 py-3.5 hover:bg-white/5 transition"
              >
                Get early access
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative bg-[#0b0b0e] pt-20 pb-10 overflow-hidden">
        <div className="relative max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 pb-14 border-b border-white/10">
            <div className="lg:col-span-2">
              <p className="font-display font-semibold text-white text-lg tracking-[0.08em] uppercase">
                Bhishi<span className="text-[#c9a15c]">.</span>
              </p>
              <p className="text-white/40 text-sm mt-3 max-w-xs leading-relaxed">
                Non-custodial ROSCA savings circles, secured on Monad. No organizer. No trust
                required.
              </p>
              <div className="flex gap-3 mt-6">
                {['X', 'GH', 'DC'].map(s => (
                  <span
                    key={s}
                    className="w-9 h-9 border border-white/10 flex items-center justify-center text-xs text-white/50 hover:border-white/25 hover:text-white transition cursor-pointer"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <span className="text-white text-sm font-semibold">Product</span>
              <div className="flex flex-col gap-2.5 mt-4 text-sm">
                <Link href="/dashboard" className="text-white/50 hover:text-white transition">Dashboard</Link>
                <Link href="/demo" className="text-white/50 hover:text-white transition">Demo</Link>
                <Link href="/create" className="text-white/50 hover:text-white transition">Create Circle</Link>
              </div>
            </div>

            <div>
              <span className="text-white text-sm font-semibold">Resources</span>
              <div className="flex flex-col gap-2.5 mt-4 text-sm">
                <a href="#how" className="text-white/50 hover:text-white transition">How it works</a>
                <a href="#trust" className="text-white/50 hover:text-white transition">Trust &amp; security</a>
              </div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 pt-8 font-mono text-xs text-white/30">
            <p>© {new Date().getFullYear()} Bhishi. Built on Monad.</p>
            <p>Testnet — use at your own risk.</p>
          </div>
        </div>
      </footer>
    </main>
  );
}

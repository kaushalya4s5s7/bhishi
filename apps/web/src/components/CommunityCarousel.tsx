'use client';
import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api';
import { Avatar, Button, Eyebrow } from '@/components/ui';

export interface CommunityEntry {
  id: string;
  name: string;
  community: string;
  location: string;
  message: string;
}

/** Shown until real early-access submissions carry a message, and mixed in
 *  permanently so columns stay full even with only a handful of real
 *  entries. `id` is a stable prefix so it never collides with a cuid. */
const SEED_ENTRIES: CommunityEntry[] = [
  { id: 'seed-1', name: 'Ananya', community: 'Chit Fund', location: 'Chennai', message: 'Finally a savings circle where I don’t have to just trust the organizer’s word for it.' },
  { id: 'seed-2', name: 'Rohit', community: 'Bhishi', location: 'Pune', message: 'Grew up with my mom running a bhishi on paper. This feels like the same trust, minus the spreadsheet errors.' },
  { id: 'seed-3', name: 'Fatima', community: 'Committee (BC)', location: 'Hyderabad', message: 'Joined with three friends abroad — the invite link made it easy even across time zones.' },
  { id: 'seed-4', name: 'Karan', community: 'Kitty Party', location: 'Delhi', message: 'The random draw actually feels fair. No one can quietly pick their favorite to go first.' },
  { id: 'seed-5', name: 'Meera', community: 'ROSCA', location: 'Bengaluru', message: 'Been part of informal groups before — this is the first one where I could verify everything myself.' },
  { id: 'seed-6', name: 'Vikram', community: 'Chit Fund', location: 'Mumbai', message: 'Set up a circle for my cousins in under five minutes. Nobody had to send bank details to anyone.' },
  { id: 'seed-7', name: 'Priya', community: 'Bhishi', location: 'Ahmedabad', message: 'Love that my deposit is what backs the group, not someone’s promise.' },
  { id: 'seed-8', name: 'Arjun', community: 'Committee (BC)', location: 'Kolkata', message: 'Auction mode is clever — got a smaller payout in exchange for going early, and everyone else got a dividend for it.' },
];

function TestimonialCard({ t }: { t: CommunityEntry }) {
  return (
    <div className="bg-white border border-[#e6e2d9] p-5 w-[280px] shrink-0">
      <div className="flex items-center gap-3">
        <Avatar seed={`${t.name}-${t.id}`} size={40} />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#0b0b0e] truncate">{t.name}</p>
          <p className="text-xs text-[#6b6470] truncate">{t.location}</p>
        </div>
      </div>
      <p className="mt-3 text-sm text-[#0b0b0e]/80 leading-relaxed line-clamp-4">{t.message}</p>
      <p className="mt-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#c9a15c]">{t.community}</p>
    </div>
  );
}

/** One auto-scrolling vertical column. `direction` picks up vs down; the
 *  card list is duplicated once so the CSS animation's -50%/0 loop point
 *  falls exactly on a repeat, hiding the seam. */
function Column({ items, direction, durationS }: { items: CommunityEntry[]; direction: 'up' | 'down'; durationS: number }) {
  const loop = [...items, ...items];
  return (
    <div className="relative h-full overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_92%,transparent)]">
      <div
        className={`flex flex-col gap-4 w-[280px] ${direction === 'up' ? 'animate-marquee-up' : 'animate-marquee-down'} hover:[animation-play-state:paused]`}
        style={{ '--marquee-duration': `${durationS}s` } as React.CSSProperties}
      >
        {loop.map((t, i) => (
          <TestimonialCard key={`${t.id}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

/** Splits items across `n` columns round-robin, so a growing list stays
 *  balanced instead of piling into the first column. */
function splitColumns(items: CommunityEntry[], n: number): CommunityEntry[][] {
  const cols: CommunityEntry[][] = Array.from({ length: n }, () => []);
  items.forEach((t, i) => cols[i % n].push(t));
  return cols.map(c => (c.length ? c : items.slice(0, Math.min(3, items.length))));
}

/** Community wall driven by real /early-access signups: anyone who fills in
 *  the optional "what do you feel" field on that form gets a card here. */
export function CommunityCarousel() {
  const [entries, setEntries] = useState<CommunityEntry[]>(SEED_ENTRIES);

  useEffect(() => {
    fetch(apiUrl('/api/waitlist/carousel'))
      .then(r => (r.ok ? r.json() : []))
      .then((rows: CommunityEntry[]) => {
        if (Array.isArray(rows) && rows.length > 0) {
          setEntries([...rows, ...SEED_ENTRIES]);
        }
      })
      .catch(() => {
        // Seeds are already showing — a failed fetch just means no real
        // signups carry a message yet, never an empty section.
      });
  }, []);

  const columns = splitColumns(entries, 4);

  return (
    <section className="py-24 sm:py-28 bg-[#f4f1ea] overflow-hidden">
      <div className="max-w-6xl mx-auto px-6">
        <div className="max-w-2xl">
          <Eyebrow>From the community</Eyebrow>
          <h2 className="font-display font-semibold text-3xl sm:text-4xl text-[#0b0b0e] leading-tight mt-4">
            People already saving together
          </h2>
          <p className="mt-5 text-[#6b6470] leading-relaxed">
            Savings circles aren&apos;t new — bhishi, chit funds, kitty parties, committees. Bhishi is
            the same idea people already trust, just enforced by code instead of goodwill.
          </p>
          <div className="mt-6">
            <Button href="/early-access" variant="ghost">
              Add your card — join the waitlist
            </Button>
          </div>
        </div>

        <div className="mt-14 h-[520px] grid grid-cols-2 sm:grid-cols-4 gap-4">
          {columns.map((col, i) => (
            <Column key={i} items={col} direction={i % 2 === 0 ? 'up' : 'down'} durationS={26 + i * 4} />
          ))}
        </div>
      </div>
    </section>
  );
}

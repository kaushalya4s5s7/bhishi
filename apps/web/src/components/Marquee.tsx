export function Marquee({ items }: { items: { label: string }[] }) {
  const loop = [...items, ...items];
  return (
    <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_10%,black_90%,transparent)]">
      <div className="flex w-max gap-10 animate-marquee hover:[animation-play-state:paused]">
        {loop.map((item, i) => (
          <div key={`${item.label}-${i}`} className="flex items-center gap-2.5 whitespace-nowrap">
            <span className="w-1 h-1 rounded-full bg-[#c9a15c]" />
            <span className="text-xs font-medium tracking-[0.12em] uppercase text-[#6b6470]">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

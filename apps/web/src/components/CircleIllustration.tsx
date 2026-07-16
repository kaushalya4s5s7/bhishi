const HANDS = [
  { angle: 0, color: '#7c5cff' },
  { angle: 60, color: '#5cd6c0' },
  { angle: 120, color: '#ff8a65' },
  { angle: 180, color: '#4c1d95' },
  { angle: 240, color: '#22c55e' },
  { angle: 300, color: '#f472b6' },
];

function Hand({ angle, color }: { angle: number; color: string }) {
  const r = 148;
  const x = 200 + r * Math.sin((angle * Math.PI) / 180);
  const y = 200 - r * Math.cos((angle * Math.PI) / 180);
  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <path
        d="M-22 26 C-26 6 -20 -14 -8 -26 C-2 -32 8 -32 12 -24 C16 -16 12 -6 6 2 L20 2 C26 2 30 8 28 14 C26 20 20 22 14 22 L18 30 C20 34 18 38 14 40 L-14 40 C-20 40 -24 34 -22 26 Z"
        fill={color}
        opacity="0.92"
      />
      <circle cx="0" cy="-6" r="9" fill="#fdf6ee" stroke={color} strokeWidth="2" />
      <text x="0" y="-2" textAnchor="middle" fontSize="9" fontWeight="700" fill={color}>
        ₹
      </text>
    </g>
  );
}

export function CircleIllustration() {
  return (
    <svg viewBox="0 0 400 400" className="w-full h-full" role="img" aria-label="A circle of hands contributing to a shared savings pot">
      <circle cx="200" cy="200" r="170" fill="none" stroke="#111111" strokeOpacity="0.06" strokeWidth="1" strokeDasharray="2 8" />
      <circle cx="200" cy="200" r="60" fill="url(#potGradient)" />
      <circle cx="200" cy="200" r="60" fill="none" stroke="#111111" strokeOpacity="0.08" strokeWidth="1" />
      <text x="200" y="196" textAnchor="middle" fontSize="13" fontWeight="600" fill="#fdf6ee" fontFamily="var(--font-display)">
        ROUND POT
      </text>
      <text x="200" y="218" textAnchor="middle" fontSize="20" fontWeight="700" fill="#fdf6ee" fontFamily="var(--font-display)">
        12,000 USDC
      </text>
      {HANDS.map(h => (
        <Hand key={h.angle} angle={h.angle} color={h.color} />
      ))}
      <defs>
        <radialGradient id="potGradient" cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#3a2a6b" />
          <stop offset="100%" stopColor="#150a2e" />
        </radialGradient>
      </defs>
    </svg>
  );
}

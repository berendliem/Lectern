"use client";

import { useEffect, useState } from "react";

/**
 * Mastered share of a course's cards. Navy-soft track, gold arc — one of the
 * two places gold is spent on home. Draws once on mount; under
 * prefers-reduced-motion the transition is off and it renders at its value.
 */
export function MasteryRing({ value, size = 44 }: { value: number | null; size?: number }) {
  const stroke = 4;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const target = value === null ? 0 : Math.max(0, Math.min(1, value));
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(target));
    return () => cancelAnimationFrame(id);
  }, [target]);

  const label = value === null ? "No cards yet" : `${Math.round(target * 100)}% mastered`;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--brand-soft)" strokeWidth={stroke} />
      {value !== null && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--gold)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - drawn)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="motion-safe:[transition:stroke-dashoffset_600ms_ease-out]"
        />
      )}
      <text
        x="50%"
        y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        className="fill-ink text-[11px] font-semibold tabular-nums"
      >
        {value === null ? "–" : `${Math.round(target * 100)}%`}
      </text>
    </svg>
  );
}

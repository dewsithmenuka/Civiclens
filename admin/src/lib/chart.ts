/** Smallest "round" axis maximum that fits `n` (1, 2, 2.5, 5, 10 × a power of ten), never below 4. */
export function niceMax(n: number): number {
  if (!Number.isFinite(n) || n <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(n));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= n) return m * pow;
  return 10 * pow;
}

export interface Plot { width: number; height: number; left: number; right: number; top: number; bottom: number }
export interface BarRect { x: number; y: number; w: number; h: number; value: number }
export interface DailyLayout {
  max: number;
  baseline: number;
  ticks: { value: number; y: number }[];
  groups: { day: string; label: string; created: BarRect; resolved: BarRect }[];
}

/** Pure layout for the "created vs resolved per day" chart — all geometry computed here so it can be unit-tested. */
export function layoutDaily(days: { day: string; created: number; resolved: number }[], p: Plot): DailyLayout {
  const max = niceMax(Math.max(0, ...days.flatMap((d) => [d.created, d.resolved])));
  const innerW = p.width - p.left - p.right;
  const innerH = p.height - p.top - p.bottom;
  const slot = days.length ? innerW / days.length : innerW;
  const barW = Math.max(2, (slot * 0.7) / 2);
  const gap = 2;
  const y = (v: number) => p.top + innerH - (v / max) * innerH;
  const bar = (value: number, x: number): BarRect => ({ x, y: y(value), w: barW, h: (value / max) * innerH, value });

  return {
    max,
    baseline: p.top + innerH,
    ticks: [0, max / 2, max].map((value) => ({ value, y: y(value) })),
    groups: days.map((d, i) => {
      const x0 = p.left + i * slot + (slot - barW * 2 - gap) / 2;
      return { day: d.day, label: d.day.slice(5), created: bar(d.created, x0), resolved: bar(d.resolved, x0 + barW + gap) };
    }),
  };
}

/** Width of a horizontal bar as a percentage of the largest value (0–100, never negative). */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(100, Math.round((value / max) * 1000) / 10);
}
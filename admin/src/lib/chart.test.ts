import { describe, expect, it } from 'vitest';
import { barPercent, layoutDaily, niceMax } from './chart';

const PLOT = { width: 640, height: 240, left: 36, right: 8, top: 12, bottom: 28 };
const days = (vals: [number, number][]) => vals.map(([created, resolved], i) => ({ day: `2026-10-${String(i + 1).padStart(2, '0')}`, created, resolved }));

describe('niceMax', () => {
  it.each([
    [0, 4], [1, 4], [4, 4], [5, 5], [7, 10], [10, 10], [11, 20], [21, 25], [26, 50], [51, 100], [99, 100], [101, 200], [250, 250], [251, 500], [999, 1000],
  ])('niceMax(%d) = %d', (n, expected) => expect(niceMax(n)).toBe(expected));
  it('is never below the value, and falls back safely for junk', () => {
    for (const n of [3, 6, 13, 37, 88, 123, 4567]) expect(niceMax(n)).toBeGreaterThanOrEqual(n);
    expect(niceMax(Number.NaN)).toBe(4);
    expect(niceMax(-5)).toBe(4);
    expect(niceMax(Infinity)).toBe(4);
  });
});

describe('layoutDaily', () => {
  it('scales bar heights to the nice maximum and keeps every bar inside the plot area', () => {
    const L = layoutDaily(days([[3, 1], [10, 6], [0, 0], [7, 10]]), PLOT);
    expect(L.max).toBe(10);
    const innerH = PLOT.height - PLOT.top - PLOT.bottom;
    expect(L.groups[1].created.h).toBeCloseTo(innerH, 6);        // the maximum fills the plot
    expect(L.groups[0].created.h).toBeCloseTo(innerH * 0.3, 6);  // 3 of 10
    expect(L.groups[2].created.h).toBe(0);
    for (const g of L.groups) for (const b of [g.created, g.resolved]) {
      expect(b.x).toBeGreaterThanOrEqual(PLOT.left);
      expect(b.x + b.w).toBeLessThanOrEqual(PLOT.width - PLOT.right + 0.001);
      expect(b.y).toBeGreaterThanOrEqual(PLOT.top - 0.001);
      expect(b.y + b.h).toBeCloseTo(L.baseline, 6); // every bar sits on the baseline
    }
  });
  it('places created and resolved side by side without overlap, and days left to right', () => {
    const L = layoutDaily(days([[1, 1], [2, 2], [3, 3]]), PLOT);
    for (const g of L.groups) expect(g.resolved.x).toBeGreaterThan(g.created.x + g.created.w - 0.001);
    expect(L.groups[1].created.x).toBeGreaterThan(L.groups[0].resolved.x);
    expect(L.groups[2].created.x).toBeGreaterThan(L.groups[1].resolved.x);
  });
  it('handles an all-zero and an empty series without NaN', () => {
    const zero = layoutDaily(days([[0, 0], [0, 0]]), PLOT);
    expect(zero.max).toBe(4);
    expect(zero.groups.every((g) => g.created.h === 0 && Number.isFinite(g.created.y))).toBe(true);
    const empty = layoutDaily([], PLOT);
    expect(empty.groups).toEqual([]);
    expect(empty.ticks).toHaveLength(3);
    expect(empty.ticks.every((t) => Number.isFinite(t.y))).toBe(true);
  });
  it('labels days as MM-DD and puts axis ticks at 0, half and max', () => {
    const L = layoutDaily(days([[8, 2]]), PLOT);
    expect(L.groups[0].label).toBe('10-01');
    expect(L.ticks.map((t) => t.value)).toEqual([0, 5, 10]); // 8 rounds up to the nice maximum 10
    expect(L.ticks[0].y).toBeCloseTo(L.baseline, 6);
  });
});

describe('barPercent', () => {
  it('is proportional, capped and never negative', () => {
    expect(barPercent(5, 10)).toBe(50);
    expect(barPercent(10, 10)).toBe(100);
    expect(barPercent(1, 3)).toBe(33.3);
    expect(barPercent(0, 10)).toBe(0);
    expect(barPercent(-3, 10)).toBe(0);
    expect(barPercent(5, 0)).toBe(0);
    expect(barPercent(20, 10)).toBe(100);
  });
});
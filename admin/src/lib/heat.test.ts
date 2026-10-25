import { describe, expect, it } from 'vitest';
import { HEAT_RAMP, cellBounds, heatBucket, heatColor, legendRanges, osmLink, overallBounds } from './heat';

describe('heatBucket / heatColor', () => {
  it('maps counts to the five ramp steps', () => {
    expect(heatBucket(1, 10)).toBe(0);
    expect(heatBucket(2, 10)).toBe(0);
    expect(heatBucket(3, 10)).toBe(1);
    expect(heatBucket(5, 10)).toBe(2);
    expect(heatBucket(7, 10)).toBe(3);
    expect(heatBucket(10, 10)).toBe(4);
  });
  it('is monotonic and always in range', () => {
    let last = 0;
    for (let c = 1; c <= 100; c++) { const b = heatBucket(c, 100); expect(b).toBeGreaterThanOrEqual(last); expect(b).toBeLessThan(HEAT_RAMP.length); last = b; }
  });
  it('handles empty data and values above the max', () => {
    expect(heatBucket(0, 0)).toBe(0);
    expect(heatBucket(5, 0)).toBe(0);
    expect(heatBucket(50, 10)).toBe(4);
    expect(heatColor(10, 10)).toBe(HEAT_RAMP[4]);
  });
  it('the ramp gets darker at every step (readable in greyscale)', () => {
    const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); return 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255); };
    for (let i = 1; i < HEAT_RAMP.length; i++) expect(lum(HEAT_RAMP[i])).toBeLessThan(lum(HEAT_RAMP[i - 1]));
  });
});

describe('geometry helpers', () => {
  it('builds a rectangle around a cell centre', () => {
    const [[a, b], [c, d]] = cellBounds({ lat: 10, lng: 20 }, 0.01);
    expect([a, b, c, d].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([9.995, 19.995, 10.005, 20.005]);
  });
  it('fits all cells, or null when there are none', () => {
    expect(overallBounds([], 0.01)).toBeNull();
    const [[s, w], [n, e]] = overallBounds([{ lat: 1, lng: 2 }, { lat: 3, lng: 5 }], 0.02)!;
    expect([s, w, n, e].map((x) => Math.round(x * 1e6) / 1e6)).toEqual([0.99, 1.99, 3.01, 5.01]);
  });
  it('links to OpenStreetMap', () => expect(osmLink(10.5, -20.25)).toContain('mlat=10.5&mlon=-20.25'));
});

describe('legendRanges', () => {
  it('covers the whole range without repeats', () => {
    const r = legendRanges(10);
    expect(r[0].label.startsWith('1')).toBe(true);
    expect(r[r.length - 1].label.endsWith('10')).toBe(true);
    expect(new Set(r.map((x) => x.label)).size).toBe(r.length);
  });
  it('copes with tiny and empty maxima', () => {
    expect(legendRanges(0)).toEqual([]);
    expect(legendRanges(1).length).toBeGreaterThan(0);
  });
});
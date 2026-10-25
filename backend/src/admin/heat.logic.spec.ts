import { BACKLOG_BUCKETS, buildHeatmap, buildInsights, cellDegreesForZoom, statusesForScope } from './heat.logic';

describe('cellDegreesForZoom', () => {
  it.each([[0, 0.1], [9, 0.1], [10, 0.02], [11, 0.02], [12, 0.005], [13, 0.005], [14, 0.002], [15, 0.002], [16, 0.0005], [19, 0.0005]])(
    'zoom %d → %d°', (z, d) => expect(cellDegreesForZoom(z)).toBe(d));
  it('clamps and rounds junk input', () => {
    expect(cellDegreesForZoom(-5)).toBe(0.1);
    expect(cellDegreesForZoom(99)).toBe(0.0005);
    expect(cellDegreesForZoom(12.4)).toBe(0.005);
    expect(cellDegreesForZoom(Number.NaN)).toBeGreaterThan(0);
  });
  it('gets finer as you zoom in', () => {
    let last = Infinity;
    for (let z = 0; z <= 19; z++) { const d = cellDegreesForZoom(z); expect(d).toBeLessThanOrEqual(last); last = d; }
  });
});

describe('statusesForScope', () => {
  it('open = the four unfinished states', () => expect(statusesForScope('open')).toEqual(['REPORTED', 'UNDER_REVIEW', 'ACKNOWLEDGED', 'IN_PROGRESS']));
  it('resolved = only RESOLVED', () => expect(statusesForScope('resolved')).toEqual(['RESOLVED']));
  it('all excludes rejected reports and merged duplicates', () => {
    const all = statusesForScope('all');
    expect(all).toContain('RESOLVED');
    expect(all).not.toContain('REJECTED');
    expect(all).not.toContain('DUPLICATE');
  });
});

describe('buildHeatmap', () => {
  const meta = { cell: 0.005, scope: 'open' as const, days: 0, category: null, limit: 3 };
  const cells = [{ lat: 1, lng: 2, n: 5, open_n: 4, oldest_open_hours: 30 }, { lat: 3, lng: 4, n: 2, open_n: 2, oldest_open_hours: 1 }];
  it('totals, finds the max, and renames fields for the API', () => {
    const r = buildHeatmap(meta, cells, []);
    expect(r.totalReports).toBe(7);
    expect(r.maxCount).toBe(5);
    expect(r.cells[0]).toEqual({ lat: 1, lng: 2, count: 5, openCount: 4, oldestOpenHours: 30 });
    expect(r.truncated).toBe(false);
  });
  it('flags truncation when the cell cap was hit, and copes with no data', () => {
    expect(buildHeatmap({ ...meta, limit: 2 }, cells, []).truncated).toBe(true);
    const empty = buildHeatmap(meta, [], []);
    expect(empty).toMatchObject({ totalReports: 0, maxCount: 0, cells: [], hotspots: [] });
  });
});

describe('buildInsights', () => {
  it('always returns all four age buckets in order, zero-filled', () => {
    const r = buildInsights([], [{ bucket: 'gt7d', n: 3 }, { bucket: 'lt1d', n: 1 }]);
    expect(r.backlogAge.map((b) => b.key)).toEqual(BACKLOG_BUCKETS.map((b) => b.key));
    expect(r.backlogAge.map((b) => b.count)).toEqual([1, 0, 0, 3]);
  });
  it('maps resolution rows, keeping null medians', () => {
    expect(buildInsights([{ category: 'ROADS', resolved: 0, open: 4, median_hours: null }], []).resolutionByCategory)
      .toEqual([{ category: 'ROADS', resolved: 0, open: 4, medianHours: null }]);
  });
});
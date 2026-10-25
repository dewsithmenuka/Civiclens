export type HeatScope = 'open' | 'resolved' | 'all';

export const OPEN_STATUSES = ['REPORTED', 'UNDER_REVIEW', 'ACKNOWLEDGED', 'IN_PROGRESS'] as const;
/** "All" means every real problem: rejected reports and merged duplicates would double-count, so they are left out. */
const ALL_STATUSES = [...OPEN_STATUSES, 'RESOLVED'] as const;

export function statusesForScope(scope: HeatScope): string[] {
  if (scope === 'open') return [...OPEN_STATUSES];
  if (scope === 'resolved') return ['RESOLVED'];
  return [...ALL_STATUSES];
}

/** Grid cell edge in degrees for a map zoom level (1° of latitude ≈ 111 km). */
export function cellDegreesForZoom(zoom: number): number {
  const z = Math.max(0, Math.min(19, Math.round(zoom)));
  if (z >= 16) return 0.0005; // ≈ 55 m
  if (z >= 14) return 0.002;  // ≈ 220 m
  if (z >= 12) return 0.005;  // ≈ 550 m
  if (z >= 10) return 0.02;   // ≈ 2.2 km
  return 0.1;                 // ≈ 11 km
}

export const HEAT_CELL_LIMIT = 2000;
export const HOTSPOT_CELL_DEGREES = 0.005;
export const HOTSPOT_LIMIT = 10;

export const BACKLOG_BUCKETS = [
  { key: 'lt1d', label: 'Under 1 day' },
  { key: '1to3d', label: '1–3 days' },
  { key: '3to7d', label: '3–7 days' },
  { key: 'gt7d', label: 'Over 7 days' },
] as const;

export interface CellRow { lat: number; lng: number; n: number; open_n: number; oldest_open_hours: number }
export interface HotspotRow { lat: number; lng: number; open_n: number; top_category: string; oldest_hours: number; confirmations: number }
export interface ResolutionRow { category: string; resolved: number; open: number; median_hours: number | null }
export interface BucketRow { bucket: string; n: number }

export function buildHeatmap(
  meta: { cell: number; scope: HeatScope; days: number; category: string | null; limit: number },
  cells: CellRow[],
  hotspots: HotspotRow[],
) {
  return {
    cellDegrees: meta.cell,
    scope: meta.scope,
    days: meta.days,
    category: meta.category,
    totalReports: cells.reduce((a, c) => a + c.n, 0),
    maxCount: cells.reduce((a, c) => Math.max(a, c.n), 0),
    truncated: cells.length >= meta.limit,
    cells: cells.map((c) => ({ lat: c.lat, lng: c.lng, count: c.n, openCount: c.open_n, oldestOpenHours: c.oldest_open_hours })),
    hotspots: hotspots.map((h) => ({
      lat: h.lat, lng: h.lng, openCount: h.open_n, topCategory: h.top_category, oldestHours: h.oldest_hours, confirmations: h.confirmations,
    })),
  };
}

export function buildInsights(resolution: ResolutionRow[], buckets: BucketRow[]) {
  const byKey = new Map(buckets.map((b) => [b.bucket, b.n]));
  return {
    backlogAge: BACKLOG_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: byKey.get(b.key) ?? 0 })),
    resolutionByCategory: resolution.map((r) => ({ category: r.category, resolved: r.resolved, open: r.open, medianHours: r.median_hours })),
  };
}
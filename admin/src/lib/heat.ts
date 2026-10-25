import type { HeatCell } from './types';

/** How finely to divide the map. `zoom` is sent to the API, which picks the matching grid size. */
export const DETAIL = {
  city: { zoom: 10, label: 'City (about 2 km cells)' },
  district: { zoom: 12, label: 'District (about 550 m)' },
  neighbourhood: { zoom: 14, label: 'Neighbourhood (about 220 m)' },
  street: { zoom: 16, label: 'Street (about 55 m)' },
} as const;
export type DetailKey = keyof typeof DETAIL;

export const SCOPE_LABEL = { open: 'Open problems', resolved: 'Resolved', all: 'Everything real' } as const;
export const PERIODS = [
  { days: 0, label: 'All time' }, { days: 7, label: 'Last 7 days' }, { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' }, { days: 365, label: 'Last year' },
] as const;

/** Sequential light-to-dark ramp: ordered by lightness too, so it still reads in greyscale and for colour-blind viewers. */
export const HEAT_RAMP = ['#FFF3B0', '#FFD166', '#F4A259', '#E4572E', '#9B2226'] as const;

export function heatBucket(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0;
  const ratio = Math.min(1, count / max);
  return Math.min(HEAT_RAMP.length - 1, Math.floor(ratio * HEAT_RAMP.length - 1e-9));
}
export const heatColor = (count: number, max: number) => HEAT_RAMP[heatBucket(count, max)];

/** Rectangle covering one grid cell (the API returns the cell's centre). */
export function cellBounds(c: Pick<HeatCell, 'lat' | 'lng'>, size: number): [[number, number], [number, number]] {
  const h = size / 2;
  return [[c.lat - h, c.lng - h], [c.lat + h, c.lng + h]];
}

export function overallBounds(cells: Pick<HeatCell, 'lat' | 'lng'>[], size: number): [[number, number], [number, number]] | null {
  if (cells.length === 0) return null;
  const h = size / 2;
  return [
    [Math.min(...cells.map((c) => c.lat)) - h, Math.min(...cells.map((c) => c.lng)) - h],
    [Math.max(...cells.map((c) => c.lat)) + h, Math.max(...cells.map((c) => c.lng)) + h],
  ];
}

export const osmLink = (lat: number, lng: number, zoom = 16) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=${zoom}/${lat}/${lng}`;

/** Legend labels like "1–2", "3–4": the count range each colour stands for. */
export function legendRanges(max: number): { color: string; label: string }[] {
  if (max <= 0) return [];
  const n = HEAT_RAMP.length;
  return HEAT_RAMP.map((color, i) => {
    const lo = Math.floor((i * max) / n) + 1, hi = Math.floor(((i + 1) * max) / n);
    return { color, label: lo >= hi ? `${Math.min(hi || lo, max)}` : `${lo}–${hi}` };
  }).filter((r, i, a) => i === 0 || r.label !== a[i - 1].label);
}
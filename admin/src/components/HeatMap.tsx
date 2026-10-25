'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';
import { cellBounds, heatColor, overallBounds } from '@/lib/heat';
import type { HeatCell } from '@/lib/types';

/**
 * Every grid cell is a rectangle shaded by how many reports fall in it. Honest and simple: no blur, no plugin,
 * and the exact numbers are in the tooltips AND in the hotspot table below (the map alone isn't keyboard- or screen-reader-friendly).
 */
export default function HeatMap({ cells, size, max }: { cells: HeatCell[]; size: number; max: number }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;
    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false });
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
      for (const c of cells) {
        L.rectangle(cellBounds(c, size), { stroke: true, color: '#20211F', weight: 0.5, opacity: 0.5, fillColor: heatColor(c.count, max), fillOpacity: 0.78 })
          .bindTooltip(`${c.count} report${c.count === 1 ? '' : 's'} (${c.openCount} open)`)
          .addTo(map);
      }
      const b = overallBounds(cells, size);
      if (b) map.fitBounds(b, { padding: [30, 30], maxZoom: 17 });
      else map.setView([20, 0], 2);
    })();
    return () => { cancelled = true; map?.remove(); };
  }, [cells, size, max]);

  return <div ref={el} className="map map-tall" role="img" aria-label={`Heatmap of ${cells.length} areas. The same figures are listed in the hotspot table below.`} />;
}
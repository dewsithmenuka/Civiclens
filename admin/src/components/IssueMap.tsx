'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

interface Point { lat: number; lng: number; title: string }

/**
 * Shows the report (red) and, when the system suspects a duplicate, the candidate (grey) on one map,
 * so a moderator can judge "same pothole?" at a glance. Leaflet touches `window`, so it is loaded lazily on the client.
 */
export default function IssueMap({ issue, other }: { issue: Point; other?: Point }) {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let map: import('leaflet').Map | undefined;
    let cancelled = false;

    (async () => {
      const L = (await import('leaflet')).default;
      if (cancelled || !el.current) return;
      map = L.map(el.current, { scrollWheelZoom: false }).setView([issue.lat, issue.lng], 18);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      const mark = (p: Point, color: string, label: string) =>
        L.circleMarker([p.lat, p.lng], { radius: 10, color: '#fff', weight: 3, fillColor: color, fillOpacity: 0.95 })
          .bindTooltip(`${label}: ${p.title}`)
          .addTo(map!);

      mark(issue, '#B5483E', 'This report');
      if (other) {
        mark(other, '#73756F', 'Possible original');
        map.fitBounds(L.latLngBounds([[issue.lat, issue.lng], [other.lat, other.lng]]), { padding: [40, 40], maxZoom: 19 });
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [issue.lat, issue.lng, issue.title, other?.lat, other?.lng, other?.title]);

  return <div ref={el} className="map" role="img" aria-label={`Map showing ${issue.title}`} />;
}
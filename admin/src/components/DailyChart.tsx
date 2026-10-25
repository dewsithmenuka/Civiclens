import { layoutDaily } from '@/lib/chart';

interface Day { day: string; created: number; resolved: number }

const PLOT = { width: 640, height: 240, left: 36, right: 8, top: 12, bottom: 28 };

/**
 * Created vs resolved per day, drawn as plain SVG on the server — no chart library, no client JavaScript,
 * nothing for the Content-Security-Policy to object to. A visually hidden table carries the same numbers for screen readers.
 */
export function DailyChart({ days }: { days: Day[] }) {
  const L = layoutDaily(days, PLOT);
  const created = days.reduce((a, d) => a + d.created, 0);
  const resolved = days.reduce((a, d) => a + d.resolved, 0);

  return (
    <figure style={{ margin: 0 }}>
      <div className="legend" aria-hidden>
        <span><i style={{ background: 'var(--info)' }} />Created</span>
        <span><i style={{ background: 'var(--accent)' }} />Resolved</span>
      </div>
      <svg
        className="chart"
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        role="img"
        aria-label={`Reports per day over the last ${days.length} days: ${created} created, ${resolved} resolved.`}
      >
        {L.ticks.map((t) => (
          <g key={t.value}>
            <line className="grid" x1={PLOT.left} x2={PLOT.width - PLOT.right} y1={t.y} y2={t.y} />
            <text x={PLOT.left - 6} y={t.y + 4} textAnchor="end">{Number.isInteger(t.value) ? t.value : t.value.toFixed(1)}</text>
          </g>
        ))}
        {L.groups.map((g, i) => (
          <g key={g.day}>
            <rect className="bar-created" x={g.created.x} y={g.created.y} width={g.created.w} height={g.created.h} rx={2}>
              <title>{`${g.day}: ${g.created.value} created`}</title>
            </rect>
            <rect className="bar-resolved" x={g.resolved.x} y={g.resolved.y} width={g.resolved.w} height={g.resolved.h} rx={2}>
              <title>{`${g.day}: ${g.resolved.value} resolved`}</title>
            </rect>
            {i % 2 === 0 && (
              <text x={g.created.x + g.created.w} y={PLOT.height - 8} textAnchor="middle">{g.label}</text>
            )}
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>Reports per day</caption>
        <thead><tr><th>Day</th><th>Created</th><th>Resolved</th></tr></thead>
        <tbody>{days.map((d) => <tr key={d.day}><td>{d.day}</td><td>{d.created}</td><td>{d.resolved}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}
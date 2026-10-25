import type { Metadata } from 'next';
import HeatMap from '@/components/HeatMap';
import { apiGet } from '@/lib/api';
import { barPercent } from '@/lib/chart';
import { CATEGORY_LABEL, formatDuration } from '@/lib/format';
import { DETAIL, PERIODS, SCOPE_LABEL, heatColor, legendRanges, osmLink, type DetailKey } from '@/lib/heat';
import type { HeatmapResponse, Insights } from '@/lib/types';
import { ISSUE_CATEGORIES } from '@civiclens/contracts';

export const metadata: Metadata = { title: 'Analytics' };
type Params = { scope?: string; days?: string; category?: string; detail?: string };

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  const scope = sp.scope === 'resolved' || sp.scope === 'all' ? sp.scope : 'open';
  const days = PERIODS.some((p) => String(p.days) === sp.days) ? Number(sp.days) : 0;
  const category = (ISSUE_CATEGORIES as readonly string[]).includes(sp.category ?? '') ? sp.category : undefined;
  const detail: DetailKey = sp.detail && sp.detail in DETAIL ? (sp.detail as DetailKey) : 'district';

  const query = new URLSearchParams({ scope, days: String(days), zoom: String(DETAIL[detail].zoom) });
  if (category) query.set('category', category);
  const [heat, insights] = await Promise.all([
    apiGet<HeatmapResponse>(`/admin/heatmap?${query}`),
    apiGet<Insights>('/admin/insights'),
  ]);

  const maxBacklog = Math.max(0, ...insights.backlogAge.map((b) => b.count));
  const legend = legendRanges(heat.maxCount);

  return (
    <>
      <h1>Analytics</h1>
      <p className="muted">Where problems cluster, how long they wait, and how quickly each kind gets fixed.</p>

      <form method="get" action="/analytics" className="card filters-4" role="search" aria-label="Heatmap filters">
        <div><label htmlFor="scope">Show</label>
          <select id="scope" name="scope" defaultValue={scope}>{Object.entries(SCOPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div><label htmlFor="days">Period</label>
          <select id="days" name="days" defaultValue={String(days)}>{PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}</select></div>
        <div><label htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={category ?? ''}><option value="">All</option>
            {ISSUE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</select></div>
        <div><label htmlFor="detail">Detail</label>
          <select id="detail" name="detail" defaultValue={detail}>{Object.entries(DETAIL).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="map-h">
        <h2 id="map-h">Heatmap</h2>
        <p className="small muted" role="status">
          {heat.cells.length === 0
            ? 'No reports match these filters.'
            : `${heat.totalReports} report${heat.totalReports === 1 ? '' : 's'} across ${heat.cells.length} area${heat.cells.length === 1 ? '' : 's'}. Busiest area: ${heat.maxCount}.${heat.truncated ? ' Showing only the busiest areas — zoom the detail out or add a filter.' : ''}`}
        </p>
        <HeatMap cells={heat.cells} size={heat.cellDegrees} max={heat.maxCount} />
        {legend.length > 0 && (
          <ul className="legend-ramp" aria-label="Colour key: reports per area">
            {legend.map((l) => <li key={l.label}><i className="swatch" style={{ background: l.color }} aria-hidden />{l.label}</li>)}
          </ul>
        )}
      </section>

      <section className="card" style={{ marginTop: 16 }} aria-labelledby="hot-h" id="hotspots">
        <h2 id="hot-h">Hotspots</h2>
        <p className="small muted">The ten busiest areas (about 550 m across) by open reports. This table lists the same data as the map.</p>
        {heat.hotspots.length === 0 ? <p className="muted">Nothing open — nice.</p> : (
          <div className="table-wrap"><table>
            <caption className="sr-only">Hotspots ranked by open reports</caption>
            <thead><tr><th scope="col">#</th><th scope="col">Open</th><th scope="col">Mostly</th><th scope="col">Oldest waiting</th><th scope="col">Confirmations</th><th scope="col">Location</th></tr></thead>
            <tbody>{heat.hotspots.map((h, i) => (
              <tr key={`${h.lat},${h.lng}`}>
                <td>{i + 1}</td>
                <td><span className="swatch" style={{ background: heatColor(h.openCount, heat.hotspots[0].openCount) }} aria-hidden /> <strong>{h.openCount}</strong></td>
                <td>{CATEGORY_LABEL[h.topCategory] ?? h.topCategory}</td>
                <td>{formatDuration(h.oldestHours)}</td>
                <td>{h.confirmations}</td>
                <td><a href={osmLink(h.lat, h.lng)} target="_blank" rel="noopener noreferrer">{h.lat.toFixed(4)}, {h.lng.toFixed(4)}<span className="sr-only"> (opens OpenStreetMap in a new tab)</span></a></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>

      <div className="two-col" style={{ marginTop: 16 }}>
        <section className="card" aria-labelledby="age-h">
          <h2 id="age-h">How long open reports have waited</h2>
          {insights.backlogAge.length === 0 ? <p className="muted">No open reports to measure.</p> : <ul className="bars">{insights.backlogAge.map((b) => (
            <li key={b.key}><span>{b.label}</span>
              <div className="bar-track" aria-hidden><div className={`bar-fill ${b.key === 'gt7d' ? 'fill-REPORTED' : ''}`} style={{ width: `${barPercent(b.count, maxBacklog)}%` }} /></div>
              <span className="bar-num">{b.count}</span></li>))}</ul>
          }
        </section>
        <section className="card" aria-labelledby="res-h">
          <h2 id="res-h">Time to fix, by category</h2>
          <div className="table-wrap"><table>
            <caption className="sr-only">Median resolution time per category</caption>
            <thead><tr><th scope="col">Category</th><th scope="col">Open</th><th scope="col">Resolved</th><th scope="col">Median time</th></tr></thead>
            <tbody>{insights.resolutionByCategory.length === 0 ? <tr><td colSpan={4} className="muted">No category data yet.</td></tr> : insights.resolutionByCategory.map((r) => (
              <tr key={r.category}><td>{CATEGORY_LABEL[r.category] ?? r.category}</td><td>{r.open}</td><td>{r.resolved}</td><td>{formatDuration(r.medianHours)}</td></tr>))}</tbody>
          </table></div>
        </section>
      </div>
    </>
  );
}
import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@/components/StatusBadge';
import { apiGet } from '@/lib/api';
import { CATEGORY_LABEL, STATUS_LABEL, timeAgo } from '@/lib/format';
import type { AdminIssueSummary, Page } from '@/lib/types';
import { ISSUE_CATEGORIES, IssueStatus } from '@civiclens/contracts';

export const metadata: Metadata = { title: 'Moderation queue' };

const PAGE_SIZE = 20;
const SORTS = { newest: 'Newest first', oldest: 'Oldest first', confirmed: 'Most confirmed' } as const;
type Params = {
  status?: string; category?: string; flagged?: string; q?: string; sort?: string; page?: string;
  reportId?: string; createdFrom?: string; createdTo?: string; latitude?: string; longitude?: string; radiusM?: string;
};

export default async function QueuePage({ searchParams }: { searchParams: Promise<Params> }) {
  const sp = await searchParams;
  // Only pass through values the API accepts; anything else is ignored rather than causing a 400 page.
  const status = Object.values(IssueStatus).includes(sp.status as IssueStatus) ? sp.status : undefined;
  const category = (ISSUE_CATEGORIES as readonly string[]).includes(sp.category ?? '') ? sp.category : undefined;
  const sort = sp.sort && sp.sort in SORTS ? sp.sort : 'newest';
  const flagged = sp.flagged === '1';
  const q = (sp.q ?? '').trim().slice(0, 100);
  const reportId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sp.reportId ?? '') ? sp.reportId : undefined;
  const createdFrom = /^\d{4}-\d{2}-\d{2}$/.test(sp.createdFrom ?? '') ? sp.createdFrom : undefined;
  const createdTo = /^\d{4}-\d{2}-\d{2}$/.test(sp.createdTo ?? '') ? sp.createdTo : undefined;
  const invalidDateRange = Boolean(createdFrom && createdTo && createdFrom > createdTo);
  const lat = Number(sp.latitude);
  const lng = Number(sp.longitude);
  const radius = Number(sp.radiusM ?? '1000');
  const hasLocation = Boolean(sp.latitude && sp.longitude)
    && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && Number.isFinite(lng) && lng >= -180 && lng <= 180
    && Number.isFinite(radius) && radius >= 1 && radius <= 50_000;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? '1', 10) || 1));

  const query = new URLSearchParams({ sort, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  if (status) query.set('status', status);
  if (category) query.set('category', category);
  if (flagged) query.set('flagged', 'true');
  if (q) query.set('search', q);
  if (reportId) query.set('reportId', reportId);
  if (createdFrom && !invalidDateRange) query.set('createdFrom', createdFrom);
  if (createdTo && !invalidDateRange) query.set('createdTo', createdTo);
  if (hasLocation) {
    query.set('latitude', String(lat));
    query.set('longitude', String(lng));
    query.set('radiusM', String(radius));
  }
  const data = await apiGet<Page<AdminIssueSummary>>(`/admin/issues?${query}`);

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (status) u.set('status', status);
    if (category) u.set('category', category);
    if (flagged) u.set('flagged', '1');
    if (q) u.set('q', q);
    if (reportId) u.set('reportId', reportId);
    if (createdFrom && !invalidDateRange) u.set('createdFrom', createdFrom);
    if (createdTo && !invalidDateRange) u.set('createdTo', createdTo);
    if (hasLocation) {
      u.set('latitude', String(lat));
      u.set('longitude', String(lng));
      u.set('radiusM', String(radius));
    }
    if (sort !== 'newest') u.set('sort', sort);
    if (p > 1) u.set('page', String(p));
    const s = u.toString();
    return `/queue${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <h1>Moderation queue</h1>
      <p className="muted">{`${data.total} report${data.total === 1 ? '' : 's'} match your filters.`}</p>

      {/* A plain GET form: works without JavaScript and keeps every filter in the URL (shareable, back-button friendly). */}
      <form method="get" action="/queue" className="card filters filters-admin" role="search" aria-label="Filter reports">
        <div>
          <label htmlFor="q">Search titles</label>
          <input id="q" name="q" defaultValue={q} placeholder="e.g. pothole" maxLength={100} />
        </div>
        <div>
          <label htmlFor="reportId">Report ID</label>
          <input id="reportId" name="reportId" defaultValue={reportId ?? ''} placeholder="Exact UUID" />
        </div>
        <div>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status ?? ''}>
            <option value="">All</option>
            {Object.values(IssueStatus).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="category">Category</label>
          <select id="category" name="category" defaultValue={category ?? ''}>
            <option value="">All</option>
            {ISSUE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={sort}>
            {Object.entries(SORTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="createdFrom">From date</label>
          <input id="createdFrom" name="createdFrom" type="date" defaultValue={createdFrom ?? ''} />
        </div>
        <div>
          <label htmlFor="createdTo">Through date</label>
          <input id="createdTo" name="createdTo" type="date" defaultValue={createdTo ?? ''} />
        </div>
        <div>
          <label htmlFor="latitude">Near latitude</label>
          <input id="latitude" name="latitude" type="number" min="-90" max="90" step="any" defaultValue={sp.latitude ?? ''} />
        </div>
        <div>
          <label htmlFor="longitude">Near longitude</label>
          <input id="longitude" name="longitude" type="number" min="-180" max="180" step="any" defaultValue={sp.longitude ?? ''} />
        </div>
        <div>
          <label htmlFor="radiusM">Radius (metres)</label>
          <input id="radiusM" name="radiusM" type="number" min="1" max="50000" defaultValue={sp.radiusM ?? '1000'} />
        </div>
        <div>
          <label className="check"><input type="checkbox" name="flagged" value="1" defaultChecked={flagged} /> Possible duplicates</label>
          <button className="btn btn-primary" type="submit">Apply</button>
        </div>
      </form>
      {invalidDateRange && <p className="alert alert-error" role="alert">The start date must be on or before the end date. Date filters were not applied.</p>}
      {Boolean(sp.latitude || sp.longitude) && !hasLocation && (
        <p className="alert alert-error" role="alert">Enter valid latitude and longitude values and a radius between 1 and 50,000 metres. The location filter was not applied.</p>
      )}

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {data.items.length === 0 ? (
          <div className="empty">
            <p><strong>Nothing here.</strong></p>
            <p>Try clearing a filter, or <Link href="/queue">reset all filters</Link>.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Report</th><th>Category</th><th>Status</th><th>Assigned to</th><th>Confirmed</th><th>Reporter</th><th>Reported</th></tr>
              </thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <Link href={`/issues/${i.id}`}><strong>{i.title}</strong></Link>
                      {i.possibleDuplicateOf && (i.status === 'REPORTED' || i.status === 'UNDER_REVIEW') && (
                        <> <span className="badge badge-flag" title="The system found a similar nearby report">possible duplicate</span></>
                      )}
                      {i.imageCount > 0 && <span className="muted small"> · {i.imageCount} photo{i.imageCount === 1 ? '' : 's'}</span>}
                    </td>
                    <td><span className="badge badge-cat">{CATEGORY_LABEL[i.category] ?? i.category}</span></td>
                    <td><StatusBadge status={i.status} /></td>
                    <td>{i.assignee?.displayName ?? <span className="muted">Unassigned</span>}</td>
                    <td>{i.confirmationCount}</td>
                    <td className="muted">{i.reporter.displayName}</td>
                    <td className="muted" title={new Date(i.createdAt).toLocaleString('en-GB')}>{timeAgo(i.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {pages > 1 && (
        <nav className="pager" aria-label="Pagination">
          {page > 1 ? <Link className="btn" href={link(page - 1)}>← Previous</Link> : <span />}
          <span className="muted small">Page {page} of {pages}</span>
          {page < pages ? <Link className="btn" href={link(page + 1)}>Next →</Link> : <span />}
        </nav>
      )}
    </>
  );
}
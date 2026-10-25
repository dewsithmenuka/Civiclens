import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { apiGet } from '@/lib/api';
import { AUDIT_ACTIONS, describeAudit, entityHref } from '@/lib/audit';
import { ROLE_LABEL, timeAgo } from '@/lib/format';
import type { AuditEntry, Me, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Audit log' };

const PAGE_SIZE = 20;
type Params = { entityType?: string; action?: string; page?: string };

export default async function AuditPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await apiGet<Me>('/auth/me');
  if (me.role !== 'ADMIN') redirect('/queue');

  const sp = await searchParams;
  const entityType = sp.entityType === 'issue' || sp.entityType === 'user' ? sp.entityType : undefined;
  const action = sp.action && sp.action in AUDIT_ACTIONS ? sp.action : undefined;
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? '1', 10) || 1));

  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  if (entityType) query.set('entityType', entityType);
  if (action) query.set('action', action);
  const data = await apiGet<Page<AuditEntry>>(`/admin/audit?${query}`);

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (entityType) u.set('entityType', entityType);
    if (action) u.set('action', action);
    if (p > 1) u.set('page', String(p));
    const s = u.toString();
    return `/audit${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">{`${data.total} recorded action${data.total === 1 ? '' : 's'}. Every moderation decision and account change is written here and cannot be edited.`}</p>

      <form method="get" action="/audit" className="card filters-3" role="search" aria-label="Filter the audit log" style={{ gridTemplateColumns: '1fr 2fr auto' }}>
        <div>
          <label htmlFor="entityType">About</label>
          <select id="entityType" name="entityType" defaultValue={entityType ?? ''}>
            <option value="">Everything</option>
            <option value="issue">Reports</option>
            <option value="user">Accounts</option>
          </select>
        </div>
        <div>
          <label htmlFor="action">Action</label>
          <select id="action" name="action" defaultValue={action ?? ''}>
            <option value="">Any action</option>
            {Object.entries(AUDIT_ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {data.items.length === 0 ? (
          <div className="empty"><p><strong>Nothing recorded for these filters.</strong></p><p><Link href="/audit">Reset filters</Link></p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th><th>Target</th></tr></thead>
              <tbody>
                {data.items.map((e) => {
                  const href = entityHref(e);
                  const detail = describeAudit(e);
                  return (
                    <tr key={e.id}>
                      <td className="muted" title={new Date(e.at).toLocaleString('en-GB')}>{timeAgo(e.at)}</td>
                      <td>
                        {e.actor ? <>{e.actor.displayName} <span className="muted small">({ROLE_LABEL[e.actor.role] ?? e.actor.role})</span></> : <span className="muted">System</span>}
                      </td>
                      <td>{AUDIT_ACTIONS[e.action] ?? e.action}</td>
                      <td>{detail || <span className="muted">—</span>}</td>
                      <td className="mono">{href ? <Link href={href}>{e.entityId.slice(0, 8)}…</Link> : <span className="muted">{e.entityType} {e.entityId.slice(0, 8)}…</span>}</td>
                    </tr>
                  );
                })}
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
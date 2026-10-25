import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { UserActions } from '@/components/UserActions';
import { apiGet } from '@/lib/api';
import { ACCOUNT_STATUS_LABEL, ROLE_LABEL, timeAgo } from '@/lib/format';
import type { AdminUser, Me, Page } from '@/lib/types';

export const metadata: Metadata = { title: 'Users' };

const PAGE_SIZE = 20;
type Params = { q?: string; role?: string; status?: string; page?: string };

export default async function UsersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const me = await apiGet<Me>('/auth/me');
  if (me.role !== 'ADMIN') redirect('/queue'); // moderators don't manage accounts; send them somewhere useful, not to an error

  const sp = await searchParams;
  const role = ['USER', 'MODERATOR', 'ADMIN'].includes(sp.role ?? '') ? sp.role : undefined;
  const status = ['ACTIVE', 'SUSPENDED', 'DELETED'].includes(sp.status ?? '') ? sp.status : undefined;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(sp.page ?? '1', 10) || 1));

  const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE) });
  if (role) query.set('role', role);
  if (status) query.set('status', status);
  if (q) query.set('search', q);
  const data = await apiGet<Page<AdminUser>>(`/admin/users?${query}`);

  const pages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const link = (p: number) => {
    const u = new URLSearchParams();
    if (role) u.set('role', role);
    if (status) u.set('status', status);
    if (q) u.set('q', q);
    if (p > 1) u.set('page', String(p));
    const s = u.toString();
    return `/users${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <h1>Users</h1>
      <p className="muted">{`${data.total} account${data.total === 1 ? '' : 's'} match your filters.`}</p>

      <form method="get" action="/users" className="card filters-3" role="search" aria-label="Filter users">
        <div>
          <label htmlFor="q">Name or email</label>
          <input id="q" name="q" defaultValue={q} maxLength={100} />
        </div>
        <div>
          <label htmlFor="role">Role</label>
          <select id="role" name="role" defaultValue={role ?? ''}>
            <option value="">All</option>
            {Object.entries(ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status ?? ''}>
            <option value="">All</option>
            {Object.entries(ACCOUNT_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <button className="btn btn-primary" type="submit">Apply</button>
      </form>

      <div className="card" style={{ marginTop: 16, padding: 0 }}>
        {data.items.length === 0 ? (
          <div className="empty"><p><strong>No accounts found.</strong></p><p><Link href="/users">Reset filters</Link></p></div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Person</th><th>Role</th><th>Status</th><th>Email verified</th><th>Reports</th><th>Joined</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {data.items.map((u) => {
                  const isMe = u.id === me.id;
                  return (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.displayName}</strong>{isMe && <span className="muted"> (you)</span>}
                        <div className="small muted">{u.email}</div>
                      </td>
                      <td><span className={`badge badge-${u.role}`}>{ROLE_LABEL[u.role] ?? u.role}</span></td>
                      <td><span className={`badge badge-${u.status}`}>{ACCOUNT_STATUS_LABEL[u.status] ?? u.status}</span></td>
                      <td>{u.emailVerified ? '✓' : '—'}</td>
                      <td>{u.issueCount}</td>
                      <td className="muted" title={new Date(u.createdAt).toLocaleString('en-GB')}>{timeAgo(u.createdAt)}</td>
                      <td>
                        {isMe || u.status === 'DELETED'
                          ? <span className="muted small">{isMe ? 'Your own account' : '—'}</span>
                          : <UserActions id={u.id} name={u.displayName} role={u.role} status={u.status as 'ACTIVE' | 'SUSPENDED'} />}
                      </td>
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
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import IssueMap from '@/components/IssueMap';
import { ModerationPanel } from '@/components/ModerationPanel';
import { AssignmentPanel } from '@/components/AssignmentPanel';
import { StatusBadge } from '@/components/StatusBadge';
import { apiGet } from '@/lib/api';
import { AUDIT_ACTIONS, describeAudit } from '@/lib/audit';
import { CATEGORY_LABEL, STATUS_LABEL, timeAgo } from '@/lib/format';
import type { AdminAssignee, AdminIssueDetail } from '@/lib/types';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export const metadata: Metadata = { title: 'Report' };

export default async function IssuePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const [issue, assignees] = await Promise.all([
    apiGet<AdminIssueDetail>(`/admin/issues/${id}`),
    apiGet<AdminAssignee[]>('/admin/assignees'),
  ]);
  const dup = issue.possibleDuplicate;
  const open = issue.status === 'REPORTED' || issue.status === 'UNDER_REVIEW';

  return (
    <>
      <p className="small"><Link href="/queue">← Back to queue</Link></p>
      <div className="row" style={{ marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>{issue.title}</h1>
        <StatusBadge status={issue.status} />
        <span className="badge badge-cat">{CATEGORY_LABEL[issue.category] ?? issue.category}</span>
      </div>

      <div className="grid-2">
        <div>
          <section className="card">
            <h2>Details</h2>
            <p>{issue.description || <span className="muted">No description provided.</span>}</p>
            <dl className="kv">
              <dt>Reported by</dt><dd>{issue.reporter.displayName}</dd>
              <dt>Reported</dt><dd>{when(issue.createdAt)} <span className="muted">({timeAgo(issue.createdAt)})</span></dd>
              <dt>Confirmations</dt><dd>{issue.confirmationCount}</dd>
              <dt>Followers</dt><dd>{issue.followerCount}</dd>
              <dt>Location</dt>
              <dd>
                {issue.location.lat.toFixed(5)}, {issue.location.lng.toFixed(5)} ·{' '}
                <a href={`https://www.openstreetmap.org/?mlat=${issue.location.lat}&mlon=${issue.location.lng}#map=19/${issue.location.lat}/${issue.location.lng}`} target="_blank" rel="noopener noreferrer">open in OpenStreetMap</a>
              </dd>
              <dt>ID</dt><dd className="small muted">{issue.id}</dd>
            </dl>
          </section>

          <section className="card">
            <h2>Location</h2>
            <IssueMap
              issue={{ ...issue.location, title: issue.title }}
              other={dup ? { ...dup.location, title: dup.title } : undefined}
            />
            <p className="small muted" style={{ marginTop: 8 }}>
              Exact position — visible to staff only. The public map shows a position rounded to about 55 m.
            </p>
          </section>

          {issue.images.length > 0 && (
            <section className="card">
              <h2>Photos ({issue.images.length})</h2>
              <div className="gallery">
                {issue.images.map((m) => (
                  // eslint-disable-next-line @next/next/no-img-element
                  <a key={m.id} href={m.url} target="_blank" rel="noopener noreferrer"><img src={m.url} alt={`Photo for ${issue.title}`} loading="lazy" referrerPolicy="no-referrer" /></a>
                ))}
              </div>
            </section>
          )}

          <section className="card">
            <h2>Timeline</h2>
            <ol className="timeline">
              {issue.timeline.map((t, i) => (
                <li key={i}>
                  <strong>{t.from ? `${STATUS_LABEL[t.from]} → ` : ''}{STATUS_LABEL[t.to]}</strong>
                  <div className="small muted">
                    {t.actor ? `${t.actor.displayName} (${t.actor.role.toLowerCase()})` : 'System'} · {when(t.at)}
                  </div>
                  {t.note && <div className="small">“{t.note}”</div>}
                </li>
              ))}
            </ol>
          </section>

          <section className="card">
            <h2>Moderator actions</h2>
            {issue.audit.length === 0 ? <p className="muted">No moderation actions have been recorded yet.</p> : (
              <ol className="timeline">
                {issue.audit.map((entry) => (
                  <li key={entry.id}>
                    <strong>{AUDIT_ACTIONS[entry.action] ?? entry.action}</strong>
                    <div className="small muted">
                      {entry.actor ? `${entry.actor.displayName} (${entry.actor.role.toLowerCase()})` : 'System'} · {when(entry.at)}
                    </div>
                    <div className="small">{describeAudit(entry)}</div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside>
          <AssignmentPanel issueId={issue.id} assignees={assignees} assigned={issue.assignee} />
          {dup && (
            <section className="card" aria-labelledby="dup-h">
              <h2 id="dup-h">Possible duplicate</h2>
              <div className="dup-card" style={{ marginBottom: 0 }}>
                <p style={{ margin: 0 }}><Link href={`/issues/${dup.id}`}><strong>{dup.title}</strong></Link></p>
                <p className="small" style={{ margin: '4px 0 0' }}>
                  <StatusBadge status={dup.status} /> · {dup.distanceM} m away · {dup.confirmationCount} confirmation{dup.confirmationCount === 1 ? '' : 's'} · {timeAgo(dup.createdAt)}
                </p>
                {open && <p className="small" style={{ margin: '8px 0 0' }}>Compare the two on the map, then use “Mark as duplicate” if they are the same problem.</p>}
              </div>
            </section>
          )}

          {issue.duplicatesOfThis.length > 0 && (
            <section className="card">
              <h2>Reports pointing at this one</h2>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {issue.duplicatesOfThis.map((d) => (
                  <li key={d.id}><Link href={`/issues/${d.id}`}>{d.title}</Link> <StatusBadge status={d.status} /></li>
                ))}
              </ul>
            </section>
          )}

          <ModerationPanel
            issueId={issue.id}
            status={issue.status}
            category={issue.category}
            candidate={dup ? { id: dup.id, title: dup.title, status: dup.status, distanceM: dup.distanceM, confirmationCount: dup.confirmationCount } : null}
          />
        </aside>
      </div>
    </>
  );
}
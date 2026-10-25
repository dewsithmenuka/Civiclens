import type { Metadata } from 'next';
import Link from 'next/link';
import { DailyChart } from '@/components/DailyChart';
import { apiGet } from '@/lib/api';
import { barPercent } from '@/lib/chart';
import { CATEGORY_LABEL, STATUS_LABEL, formatDuration } from '@/lib/format';
import type { AdminStats } from '@/lib/types';
import { IssueStatus } from '@civiclens/contracts';

export const metadata: Metadata = { title: 'Statistics' };

const LIFECYCLE: IssueStatus[] = [
  IssueStatus.REPORTED, IssueStatus.UNDER_REVIEW, IssueStatus.ACKNOWLEDGED, IssueStatus.IN_PROGRESS,
  IssueStatus.RESOLVED, IssueStatus.DUPLICATE, IssueStatus.REJECTED,
];

export default async function StatsPage() {
  const s = await apiGet<AdminStats>('/admin/stats');
  const maxStatus = Math.max(0, ...LIFECYCLE.map((k) => s.byStatus[k] ?? 0));
  const maxCategory = Math.max(0, ...s.byCategory.map((c) => c.count));
  const unreviewedOld = s.queue.oldestUnreviewedHours >= 48;

  return (
    <>
      <h1>Statistics</h1>
      <p className="muted">A live view of the moderation workload and how quickly problems get fixed.</p>

      <div className="kpis">
        <Link className="kpi" href="/queue?status=REPORTED">
          <div className="kpi-label">Open queue</div>
          <div className="kpi-value" data-kpi="open">{s.queue.open}</div>
          <div className="kpi-sub">reported or under review</div>
        </Link>
        <Link className="kpi" href="/queue?flagged=1">
          <div className="kpi-label">Possible duplicates</div>
          <div className="kpi-value" data-kpi="flagged">{s.queue.flaggedDuplicates}</div>
          <div className="kpi-sub">waiting for a decision</div>
        </Link>
        <div className={`kpi ${unreviewedOld ? 'kpi-warn' : ''}`}>
          <div className="kpi-label">Oldest unreviewed</div>
          <div className="kpi-value" data-kpi="oldest">{s.queue.open === 0 ? '—' : formatDuration(s.queue.oldestUnreviewedHours)}</div>
          <div className="kpi-sub">{unreviewedOld ? 'needs attention' : 'time since first report'}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Median time to resolve</div>
          <div className="kpi-value" data-kpi="median">{formatDuration(s.resolution.medianHours)}</div>
          <div className="kpi-sub">{`last ${s.resolution.windowDays} days · ${s.resolution.sampleSize} resolved`}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">All reports</div>
          <div className="kpi-value" data-kpi="total">{s.totalIssues}</div>
          <div className="kpi-sub">since launch</div>
        </div>
      </div>

      <section className="card" aria-labelledby="daily-h">
        <h2 id="daily-h">Last 14 days</h2>
        <DailyChart days={s.last14Days} />
      </section>

      <div className="two-col" style={{ marginTop: 16 }}>
        <section className="card" aria-labelledby="status-h">
          <h2 id="status-h">By status</h2>
          <ul className="bars">
            {LIFECYCLE.map((k) => (
              <li key={k}>
                <Link href={`/queue?status=${k}`}>{STATUS_LABEL[k]}</Link>
                <div className="bar-track" aria-hidden><div className={`bar-fill fill-${k}`} style={{ width: `${barPercent(s.byStatus[k] ?? 0, maxStatus)}%` }} /></div>
                <span className="bar-num">{s.byStatus[k] ?? 0}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="cat-h">
          <h2 id="cat-h">By category</h2>
          {s.byCategory.length === 0 ? <p className="muted">No reports yet.</p> : (
            <ul className="bars">
              {s.byCategory.map((c) => (
                <li key={c.category}>
                  <Link href={`/queue?category=${c.category}`}>{CATEGORY_LABEL[c.category] ?? c.category}</Link>
                  <div className="bar-track" aria-hidden><div className="bar-fill" style={{ width: `${barPercent(c.count, maxCategory)}%` }} /></div>
                  <span className="bar-num">{c.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ISSUE_CATEGORIES, ISSUE_TRANSITIONS, IssueStatus } from '@civiclens/contracts';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/lib/format';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ACTION_LABEL: Partial<Record<IssueStatus, string>> = {
  [IssueStatus.UNDER_REVIEW]: 'Start review',
  [IssueStatus.ACKNOWLEDGED]: 'Acknowledge',
  [IssueStatus.IN_PROGRESS]: 'Mark in progress',
  [IssueStatus.RESOLVED]: 'Mark resolved',
  [IssueStatus.DUPLICATE]: 'Mark as duplicate…',
  [IssueStatus.REJECTED]: 'Reject report',
};

interface Candidate { id: string; title: string; status: string; distanceM: number; confirmationCount: number }
type Notice = { kind: 'ok' | 'error'; text: string } | null;

function apiMessage(data: { message?: string | string[] }, fallback: string) {
  return Array.isArray(data.message) ? data.message.join(' ') : (data.message ?? fallback);
}

export function ModerationPanel({ issueId, status, category, candidate }: {
  issueId: string; status: IssueStatus; category: string; candidate: Candidate | null;
}) {
  const router = useRouter();
  const allowed = ISSUE_TRANSITIONS[status] ?? [];
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [merging, setMerging] = useState(false);
  const [target, setTarget] = useState(candidate?.id ?? '');
  const [cat, setCat] = useState(category);

  /** All calls go through the same-origin BFF proxy: the browser never sees a token. */
  async function patch(path: string, body: object): Promise<boolean> {
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(`/api/bff/${path}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.status === 401) {
        // Access token expired while the page was open: refresh through a navigation, then come back here.
        window.location.href = `/session/refresh?next=${encodeURIComponent(window.location.pathname)}`;
        return false;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({ kind: 'error', text: apiMessage(data, res.status === 403 ? 'You no longer have permission to do this.' : 'That did not work.') });
        return false;
      }
      return true;
    } catch {
      setNotice({ kind: 'error', text: 'Network error — nothing was changed.' });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function changeStatus(to: IssueStatus) {
    if (to === IssueStatus.DUPLICATE && !merging) { setMerging(true); return; }
    if (to === IssueStatus.DUPLICATE && !UUID.test(target.trim())) {
      setNotice({ kind: 'error', text: 'Paste the ID of the original report (or use the suggested one).' });
      return;
    }
    if (to === IssueStatus.REJECTED && !window.confirm('Reject this report? It will disappear from the public map.')) return;

    const body: Record<string, string> = { status: to };
    if (note.trim()) body.note = note.trim();
    if (to === IssueStatus.DUPLICATE) body.duplicateOfId = target.trim();

    if (await patch(`admin/issues/${issueId}/status`, body)) {
      setNotice({ kind: 'ok', text: `Status changed to “${STATUS_LABEL[to]}”.` });
      setNote('');
      setMerging(false);
      router.refresh();
    }
  }

  async function saveCategory() {
    if (await patch(`admin/issues/${issueId}`, { category: cat })) {
      setNotice({ kind: 'ok', text: `Category changed to ${CATEGORY_LABEL[cat] ?? cat}.` });
      router.refresh();
    }
  }

  return (
    <section className="card" aria-labelledby="mod-h">
      <h2 id="mod-h">Moderation</h2>
      {notice && <div className={`alert ${notice.kind === 'ok' ? 'alert-ok' : 'alert-error'}`} role={notice.kind === 'ok' ? 'status' : 'alert'}>{notice.text}</div>}

      {allowed.length === 0 ? (
        <p className="muted">This report is <strong>{STATUS_LABEL[status]}</strong> — a final state. No further status changes are possible.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor="note">Note for the timeline (optional)</label>
            <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Why are you doing this?" />
          </div>

          {merging && (
            <div className="dup-card">
              <strong>Merge into the original report</strong>
              <p className="small" style={{ margin: '6px 0 10px' }}>
                Followers and confirmations move to the original, and this report disappears from the public map.
              </p>
              {candidate && (
                <p className="small">Suggested: <a href={`/issues/${candidate.id}`}>{candidate.title}</a> ({candidate.distanceM} m away)</p>
              )}
              <label htmlFor="target">Original report ID</label>
              <input id="target" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="3f2a9c1e-…" spellCheck={false} />
            </div>
          )}

          <div className="actions">
            {allowed.map((to) => (
              <button
                key={to}
                className={`btn ${to === IssueStatus.REJECTED ? 'btn-danger' : to === IssueStatus.DUPLICATE ? '' : 'btn-primary'}`}
                disabled={busy}
                onClick={() => changeStatus(to)}
              >
                {to === IssueStatus.DUPLICATE && merging ? 'Confirm merge' : (ACTION_LABEL[to] ?? STATUS_LABEL[to])}
              </button>
            ))}
            {merging && <button className="btn" disabled={busy} onClick={() => { setMerging(false); setNotice(null); }}>Cancel merge</button>}
          </div>
        </>
      )}

      <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '18px 0' }} />
      <div className="field">
        <label htmlFor="cat">Category</label>
        <div className="row">
          <select id="cat" value={cat} onChange={(e) => setCat(e.target.value)} style={{ flex: 1 }}>
            {ISSUE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </select>
          <button className="btn" disabled={busy || cat === category} onClick={saveCategory}>Save</button>
        </div>
      </div>
    </section>
  );
}
'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { AdminAssignee } from '@/lib/types';

export function AssignmentPanel({ issueId, assignees, assigned }: {
  issueId: string; assignees: AdminAssignee[]; assigned: AdminAssignee | null;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState(assigned?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/bff/admin/issues/${issueId}/assignee`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assigneeId: selected || null }),
      });
      if (response.status === 401) {
        window.location.href = `/session/refresh?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ text: typeof data.message === 'string' ? data.message : 'Assignment could not be saved.', error: true });
        return;
      }
      setMessage({ text: selected ? 'Report assigned.' : 'Report unassigned.', error: false });
      router.refresh();
    } catch {
      setMessage({ text: 'Network error — the assignment was not changed.', error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card" aria-labelledby="assignee-h">
      <h2 id="assignee-h">Assignment</h2>
      <label htmlFor="assignee">Moderator or admin</label>
      <select id="assignee" value={selected} onChange={(event) => setSelected(event.target.value)}>
        <option value="">Unassigned</option>
        {assignees.map((person) => (
          <option key={person.id} value={person.id}>{person.displayName} ({person.role.toLowerCase()})</option>
        ))}
      </select>
      {assignees.length === 0 && <p className="small muted" style={{ marginTop: 8 }}>No active moderators or admins are available.</p>}
      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy || selected === (assigned?.id ?? '')} onClick={save}>
        {busy ? 'Saving…' : 'Save assignment'}
      </button>
      {message && <p className={`small ${message.error ? 'alert-error' : 'alert-ok'}`} role={message.error ? 'alert' : 'status'} style={{ marginTop: 10 }}>{message.text}</p>}
    </section>
  );
}

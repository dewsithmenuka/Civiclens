'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ROLE_LABEL } from '@/lib/format';
import type { Role } from '@/lib/types';

const ROLES: Role[] = ['USER', 'MODERATOR', 'ADMIN'];

function apiMessage(data: { message?: string | string[] }, fallback: string) {
  return Array.isArray(data.message) ? data.message.join(' ') : (data.message ?? fallback);
}

/** Change a person's role or suspend / reactivate them. Calls go through the same-origin proxy — no token in the browser. */
export function UserActions({ id, name, role, status }: { id: string; name: string; role: Role; status: 'ACTIVE' | 'SUSPENDED' }) {
  const router = useRouter();
  const [newRole, setNewRole] = useState<Role>(role);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: { role?: Role; status?: 'ACTIVE' | 'SUSPENDED' }) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/bff/admin/users/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
      if (res.status === 401) {
        window.location.href = `/session/refresh?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(apiMessage(data, res.status === 403 ? 'You no longer have permission to do this.' : 'That did not work.'));
        return;
      }
      router.refresh();
    } catch {
      setError('Network error — nothing was changed.');
    } finally {
      setBusy(false);
    }
  }

  function saveRole() {
    if (newRole === 'ADMIN' && !window.confirm(`Make ${name} an administrator? Admins can manage every account.`)) return;
    void patch({ role: newRole });
  }

  function toggleStatus() {
    if (status === 'ACTIVE') {
      if (!window.confirm(`Suspend ${name}? They will be signed out everywhere immediately.`)) return;
      void patch({ status: 'SUSPENDED' });
    } else {
      void patch({ status: 'ACTIVE' });
    }
  }

  return (
    <div>
      <div className="user-actions" data-actions-for={id}>
        <label className="sr-only" htmlFor={`role-${id}`}>Role for {name}</label>
        <select id={`role-${id}`} value={newRole} onChange={(e) => setNewRole(e.target.value as Role)} disabled={busy}>
          {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
        </select>
        <button className="btn btn-sm" disabled={busy || newRole === role} onClick={saveRole}>Save</button>
        <button className={`btn btn-sm ${status === 'ACTIVE' ? 'btn-danger' : ''}`} disabled={busy} onClick={toggleStatus}>
          {status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
        </button>
      </div>
      {error && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }} role="alert">{error}</div>}
    </div>
  );
}
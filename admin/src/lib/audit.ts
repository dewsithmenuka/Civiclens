import { CATEGORY_LABEL, STATUS_LABEL, ROLE_LABEL, ACCOUNT_STATUS_LABEL } from './format';
import type { AuditEntry } from './types';

export const AUDIT_ACTIONS: Record<string, string> = {
  'issue.status_changed': 'Status changed',
  'issue.category_changed': 'Category changed',
  'issue.assigned': 'Report assigned',
  'user.updated': 'Account changed',
  'auth.register': 'Registered',
  'auth.email_verified': 'Email verified',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset_completed': 'Password reset completed',
  'auth.refresh_reuse_detected': 'Stolen session detected',
  'auth.google_register': 'Registered with Google',
  'auth.google_linked': 'Google account linked',
  'auth.unverified_account_claimed_via_google': 'Unverified account claimed via Google',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const short = (id: string) => id.slice(0, 8);

/** One human-readable line describing what changed. Always plain text (React escapes it on render). */
export function describeAudit(e: Pick<AuditEntry, 'action' | 'metadata'>): string {
  const m = obj(e.metadata);
  switch (e.action) {
    case 'issue.status_changed': {
      const base = `${STATUS_LABEL[str(m.from)] ?? str(m.from)} → ${STATUS_LABEL[str(m.to)] ?? str(m.to)}`;
      return m.duplicateOf ? `${base} (merged into ${short(str(m.duplicateOf))}…)` : base;
    }
    case 'issue.category_changed':
      return `${CATEGORY_LABEL[str(m.from)] ?? str(m.from)} → ${CATEGORY_LABEL[str(m.to)] ?? str(m.to)}`;
    case 'issue.assigned':
      if (m.to) return `Assigned to ${str(m.toName) || `${short(str(m.to))}…`}`;
      return m.fromName ? `Unassigned from ${str(m.fromName)}` : 'Unassigned';
    case 'user.updated': {
      const before = obj(m.before), after = obj(m.after);
      const parts: string[] = [];
      if (before.role !== after.role) parts.push(`role ${ROLE_LABEL[str(before.role)] ?? str(before.role)} → ${ROLE_LABEL[str(after.role)] ?? str(after.role)}`);
      if (before.status !== after.status) parts.push(`status ${ACCOUNT_STATUS_LABEL[str(before.status)] ?? str(before.status)} → ${ACCOUNT_STATUS_LABEL[str(after.status)] ?? str(after.status)}`);
      return parts.join(', ') || 'no change';
    }
    default: {
      const json = e.metadata && Object.keys(e.metadata).length ? JSON.stringify(e.metadata) : '';
      return json.length > 120 ? `${json.slice(0, 117)}…` : json;
    }
  }
}

/** Issues link to their page; everything else has none. Only ever returns an in-app path. */
export function entityHref(e: Pick<AuditEntry, 'entityType' | 'entityId'>): string | null {
  return e.entityType === 'issue' && UUID.test(e.entityId) ? `/issues/${e.entityId}` : null;
}
import { describe, expect, it } from 'vitest';
import { AUDIT_ACTIONS, describeAudit, entityHref } from './audit';

const ID = '3f2a9c1e-7b4d-4e6a-9d21-0a1b2c3d4e5f';

describe('describeAudit', () => {
  it('describes status changes with friendly labels', () => {
    expect(describeAudit({ action: 'issue.status_changed', metadata: { from: 'UNDER_REVIEW', to: 'ACKNOWLEDGED' } })).toBe('Under review → Acknowledged');
  });
  it('mentions the merge target for duplicates (shortened)', () => {
    expect(describeAudit({ action: 'issue.status_changed', metadata: { from: 'REPORTED', to: 'DUPLICATE', duplicateOf: ID } })).toBe('Reported → Duplicate (merged into 3f2a9c1e…)');
  });
  it('describes category changes', () => {
    expect(describeAudit({ action: 'issue.category_changed', metadata: { from: 'ROADS', to: 'ACCESSIBILITY' } })).toBe('Roads → Accessibility');
  });
  it('describes moderator assignment changes', () => {
    expect(describeAudit({ action: 'issue.assigned', metadata: { from: ID, fromName: 'Alex', to: 'another-id', toName: 'Riley' } })).toBe('Assigned to Riley');
    expect(describeAudit({ action: 'issue.assigned', metadata: { from: ID, fromName: 'Alex', to: null } })).toBe('Unassigned from Alex');
    expect(AUDIT_ACTIONS['issue.assigned']).toBe('Report assigned');
  });
  it('shows only what changed on an account', () => {
    expect(describeAudit({ action: 'user.updated', metadata: { before: { role: 'USER', status: 'ACTIVE' }, after: { role: 'MODERATOR', status: 'ACTIVE' } } })).toBe('role User → Moderator');
    expect(describeAudit({ action: 'user.updated', metadata: { before: { role: 'MODERATOR', status: 'ACTIVE' }, after: { role: 'MODERATOR', status: 'SUSPENDED' } } })).toBe('status Active → Suspended');
    expect(describeAudit({ action: 'user.updated', metadata: { before: { role: 'USER', status: 'ACTIVE' }, after: { role: 'ADMIN', status: 'SUSPENDED' } } })).toBe('role User → Admin, status Active → Suspended');
    expect(describeAudit({ action: 'user.updated', metadata: { before: { role: 'USER', status: 'ACTIVE' }, after: { role: 'USER', status: 'ACTIVE' } } })).toBe('no change');
  });
  it('never throws on missing or malformed metadata', () => {
    for (const action of ['issue.status_changed', 'issue.category_changed', 'user.updated', 'something.else']) {
      expect(() => describeAudit({ action, metadata: null })).not.toThrow();
      expect(() => describeAudit({ action, metadata: { from: 5, to: {}, before: 'x', after: [] } as never })).not.toThrow();
    }
    expect(describeAudit({ action: 'auth.register', metadata: null })).toBe('');
    expect(describeAudit({ action: 'auth.register', metadata: {} })).toBe('');
  });
  it('falls back to truncated JSON for unknown actions', () => {
    expect(describeAudit({ action: 'x.y', metadata: { a: 1 } })).toBe('{"a":1}');
    const long = describeAudit({ action: 'x.y', metadata: { note: 'z'.repeat(300) } });
    expect(long.length).toBe(118);
    expect(long.endsWith('…')).toBe(true);
  });
  it('knows a label for every action the API writes', () => {
    for (const a of ['issue.status_changed', 'issue.category_changed', 'issue.assigned', 'user.updated', 'auth.register', 'auth.email_verified', 'auth.password_reset_requested', 'auth.password_reset_completed', 'auth.refresh_reuse_detected', 'auth.google_register', 'auth.google_linked', 'auth.unverified_account_claimed_via_google']) {
      expect(AUDIT_ACTIONS[a]).toBeTruthy();
    }
  });
});

describe('entityHref', () => {
  it('links issues to their page and nothing else', () => {
    expect(entityHref({ entityType: 'issue', entityId: ID })).toBe(`/issues/${ID}`);
    expect(entityHref({ entityType: 'user', entityId: ID })).toBeNull();
  });
  it('refuses anything that is not a UUID (no path tricks)', () => {
    for (const bad of ['../../login', 'not-a-uuid', `${ID}/../x`, '', 'javascript:alert(1)']) {
      expect(entityHref({ entityType: 'issue', entityId: bad })).toBeNull();
    }
  });
});
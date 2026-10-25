import { describe, expect, it } from 'vitest';
import { isAllowedProxyPath } from './proxy-allow';

const ID = '3f2a9c1e-7b4d-4e6a-9d21-0a1b2c3d4e5f';

describe('BFF proxy allow-list', () => {
  it('allows the dashboard’s own routes with the right methods', () => {
    expect(isAllowedProxyPath('admin/issues', 'GET')).toBe(true);
    expect(isAllowedProxyPath('admin/assignees', 'GET')).toBe(true);
    expect(isAllowedProxyPath(`admin/issues/${ID}`, 'GET')).toBe(true);
    expect(isAllowedProxyPath(`admin/issues/${ID}`, 'PATCH')).toBe(true);
    expect(isAllowedProxyPath(`admin/issues/${ID}/assignee`, 'PATCH')).toBe(true);
    expect(isAllowedProxyPath(`admin/issues/${ID}/status`, 'PATCH')).toBe(true);
    expect(isAllowedProxyPath('admin/stats', 'GET')).toBe(true);
    expect(isAllowedProxyPath(`admin/users/${ID}`, 'PATCH')).toBe(true);
    expect(isAllowedProxyPath('admin/audit', 'GET')).toBe(true);
  });
  it('blocks wrong methods', () => {
    expect(isAllowedProxyPath('admin/issues', 'POST')).toBe(false);
    expect(isAllowedProxyPath(`admin/issues/${ID}`, 'DELETE')).toBe(false);
    expect(isAllowedProxyPath('admin/stats', 'PATCH')).toBe(false);
    expect(isAllowedProxyPath('admin/users', 'PATCH')).toBe(false);
  });
  it('blocks everything outside /admin — the proxy is not a general API tunnel', () => {
    for (const p of ['auth/login', 'auth/me', 'auth/refresh', 'issues', `issues/${ID}/status`, 'uploads/presign', 'devices', 'categories', 'health/ready']) {
      expect(isAllowedProxyPath(p, 'GET')).toBe(false);
      expect(isAllowedProxyPath(p, 'PATCH')).toBe(false);
    }
  });
  it('blocks traversal and malformed ids', () => {
    expect(isAllowedProxyPath('admin/../auth/login', 'GET')).toBe(false);
    expect(isAllowedProxyPath(`admin/issues/${ID}/../../users`, 'GET')).toBe(false);
    expect(isAllowedProxyPath('admin/issues/not-a-uuid', 'GET')).toBe(false);
    expect(isAllowedProxyPath(`admin/issues/${ID}/status/extra`, 'PATCH')).toBe(false);
    expect(isAllowedProxyPath(`/admin/issues`, 'GET')).toBe(false);
    expect(isAllowedProxyPath(`admin/issues/${ID}%2F..%2Fusers`, 'GET')).toBe(false);
  });
});
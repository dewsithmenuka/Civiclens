const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

/** The browser may only reach these API routes, through the BFF proxy, with these methods. Everything else is a 404. */
const ROUTES: { method: 'GET' | 'PATCH'; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^admin\/issues$/ },
  { method: 'GET', pattern: /^admin\/assignees$/ },
  { method: 'GET', pattern: new RegExp(`^admin/issues/${UUID}$`) },
  { method: 'PATCH', pattern: new RegExp(`^admin/issues/${UUID}$`) },
  { method: 'PATCH', pattern: new RegExp(`^admin/issues/${UUID}/assignee$`) },
  { method: 'PATCH', pattern: new RegExp(`^admin/issues/${UUID}/status$`) },
  { method: 'GET', pattern: /^admin\/stats$/ },
  { method: 'GET', pattern: /^admin\/users$/ },
  { method: 'PATCH', pattern: new RegExp(`^admin/users/${UUID}$`) },
  { method: 'GET', pattern: /^admin\/audit$/ },
];

export function isAllowedProxyPath(path: string, method: string): boolean {
  return ROUTES.some((r) => r.method === method && r.pattern.test(path));
}
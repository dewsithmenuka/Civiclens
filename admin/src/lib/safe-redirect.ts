/**
 * Open-redirect protection for the `next` parameter. Only same-site absolute paths are allowed:
 * no scheme, no `//host`, no backslashes, no control characters, and never back into the auth endpoints.
 */
export function safeNext(input: string | null | undefined, fallback = '/queue'): string {
  if (typeof input !== 'string' || input.length === 0 || input.length > 2000) return fallback;
  if (!input.startsWith('/') || input.startsWith('//')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(input)) return fallback;
  let url: URL;
  try {
    url = new URL(input, 'http://placeholder.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'http://placeholder.invalid') return fallback;
  if (url.pathname === '/login' || url.pathname.startsWith('/session')) return fallback;
  return url.pathname + url.search;
}
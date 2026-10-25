import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, API_V1, APP_ORIGIN } from '@/lib/config';
import { checkSameOrigin, isJsonRequest } from '@/lib/csrf';
import { isAllowedProxyPath } from '@/lib/proxy-allow';

const MAX_BODY_BYTES = 64 * 1024;
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } });

/**
 * Backend-for-frontend proxy. Browser code calls THIS (same origin, cookies attached automatically);
 * we add the Authorization header from the httpOnly cookie. The browser never holds a token.
 * Only an allow-list of /admin routes is reachable, and mutations are CSRF-checked.
 */
async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const path = (await ctx.params).path.join('/');
  if (!isAllowedProxyPath(path, req.method)) return json({ error: 'Not found' }, 404);

  if (req.method !== 'GET') {
    if (!checkSameOrigin(req.headers, APP_ORIGIN)) return json({ error: 'Cross-origin request refused.' }, 403);
    if (!isJsonRequest(req.headers)) return json({ error: 'Expected JSON.' }, 415);
  }

  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return json({ error: 'session_expired' }, 401);

  let body: string | undefined;
  if (req.method !== 'GET') {
    body = await req.text();
    if (new TextEncoder().encode(body).length > MAX_BODY_BYTES) return json({ error: 'Request too large.' }, 413);
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${API_V1}/${path}${req.nextUrl.search}`, {
      method: req.method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body,
      cache: 'no-store',
    });
  } catch {
    return json({ error: 'Cannot reach the CivicLens API.' }, 502);
  }

  // 401 from the API means the access token expired: the client navigates to /session/refresh and retries.
  return new NextResponse(await upstream.text(), {
    status: upstream.status,
    headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json', 'cache-control': 'no-store' },
  });
}

export { handle as GET, handle as PATCH };
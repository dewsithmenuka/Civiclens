import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, API_V1, SESSION_COOKIE } from '@/lib/config';
import { isExpiringSoon } from '@/lib/jwt';

const ISSUE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFoundResponse(csp: string) {
  return new NextResponse(
    '<!doctype html><html lang="en"><meta charset="utf-8"><title>Not found</title><body><main><h1>Report not found</h1><p>This report may have been removed or is unavailable.</p><a href="/queue">Back to queue</a></main></body></html>',
    {
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
      },
    },
  );
}

/**
 * Runs on every request. Two jobs:
 *  1. Content-Security-Policy with a fresh nonce per request (scripts need the nonce — injected scripts don't run).
 *  2. Keep the session fresh: if the access token is missing/expiring, send the browser through /session/refresh
 *     (a navigation — only one tab/request at a time rotates the refresh token) and bring it straight back.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const dev = process.env.NODE_ENV === 'development';
  const nonce = btoa(crypto.randomUUID());

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'unsafe-inline'`, // Leaflet positions tiles with inline style attributes
    `img-src 'self' data: blob: https:`, // OSM map tiles + report photos from the storage CDN
    `font-src 'self'`,
    `connect-src 'self'${dev ? ' ws: wss:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');

  // Public: the sign-in page, the session endpoints, and the BFF proxy (which answers 401 itself).
  const isPublic = pathname === '/login' || pathname.startsWith('/session/') || pathname.startsWith('/api/bff/');
  const isPrefetch = req.headers.get('next-router-prefetch') !== null || req.headers.get('purpose') === 'prefetch';
  const access = req.cookies.get(ACCESS_COOKIE)?.value;

  if (!isPublic && !isPrefetch) {
    if (!access || isExpiringSoon(access)) {
      const hasSession = req.cookies.get(SESSION_COOKIE)?.value === '1';
      const dest = new URL(hasSession ? '/session/refresh' : '/login', req.nextUrl.origin);
      dest.searchParams.set('next', pathname + search);
      return NextResponse.redirect(dest);
    }
  }

  const issueId = /^\/issues\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (issueId !== undefined) {
    if (!ISSUE_UUID.test(issueId)) return notFoundResponse(csp);
    if (access && !isExpiringSoon(access)) {
      const response = await fetch(`${API_V1}/admin/issues/${issueId}`, {
        headers: { authorization: `Bearer ${access}` },
        cache: 'no-store',
      });
      if (response.status === 404) return notFoundResponse(csp);
    }
  }

  const headers = new Headers(req.headers);
  headers.set('x-nonce', nonce);
  headers.set('x-pathname', pathname + search);
  headers.set('content-security-policy', csp); // Next.js reads the nonce from here and stamps its own scripts

  const res = NextResponse.next({ request: { headers } });
  res.headers.set('Content-Security-Policy', csp);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
import { NextResponse, type NextRequest } from 'next/server';

import {
  API_V1,
  APP_ORIGIN,
  REFRESH_COOKIE,
} from '@/lib/config';

import { forwardIp } from '@/lib/client-ip';
import { safeNext } from '@/lib/safe-redirect';
import {
  applySession,
  clearSession,
  markFresh,
  type Tokens,
} from '@/lib/session';

/**
 * Silent token refresh as a navigation:
 * middleware (or a page that got a 401) redirects here,
 * we rotate the tokens, set the new cookies, and redirect
 * straight back.
 *
 * The refresh token only ever travels to /session/*.
 */
export async function GET(req: NextRequest) {
  const origin = APP_ORIGIN ?? req.nextUrl.origin;

  const next = safeNext(
    req.nextUrl.searchParams.get('next'),
  );

  const toLogin = () => {
    const url = new URL('/login', origin);

    url.searchParams.set('error', 'session');
    url.searchParams.set('next', next);

    const res = NextResponse.redirect(url);

    clearSession(res);

    return res;
  };

  const refreshToken =
    req.cookies.get(REFRESH_COOKIE)?.value;

  if (!refreshToken) {
    return toLogin();
  }

  let r: Response;

  try {
    r = await fetch(`${API_V1}/auth/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...forwardIp(req.headers),
      },
      body: JSON.stringify({ refreshToken }),
      cache: 'no-store',
    });
  } catch {
    return toLogin();
  }

  // Expired, revoked, or reuse detected — start over.
  if (!r.ok) {
    return toLogin();
  }

  const res = NextResponse.redirect(
    new URL(next, origin),
  );

  applySession(res, (await r.json()) as Tokens);

  markFresh(res);

  return res;
}
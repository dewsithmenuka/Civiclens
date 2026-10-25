import { NextResponse, type NextRequest } from 'next/server';

import { API_V1, APP_ORIGIN, STAFF_ROLES } from '@/lib/config';
import { checkSameOrigin, isJsonRequest } from '@/lib/csrf';
import { forwardIp } from '@/lib/client-ip';
import { applySession, type Tokens } from '@/lib/session';

const fail = (error: string, status: number) =>
  NextResponse.json(
    { error },
    {
      status,
      headers: { 'cache-control': 'no-store' },
    },
  );

export async function POST(req: NextRequest) {
  if (!checkSameOrigin(req.headers, APP_ORIGIN)) {
    return fail('Cross-origin request refused.', 403);
  }

  if (!isJsonRequest(req.headers)) {
    return fail('Expected JSON.', 415);
  }

  let body: { email?: unknown; password?: unknown };

  try {
    body = await req.json();
  } catch {
    return fail('Invalid request.', 400);
  }

  const email =
    typeof body.email === 'string' ? body.email.trim() : '';

  const password =
    typeof body.password === 'string' ? body.password : '';

  if (
    !email ||
    !password ||
    email.length > 254 ||
    password.length > 128
  ) {
    return fail('Enter your email and password.', 400);
  }

  let login: Response;

  try {
    login = await fetch(`${API_V1}/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...forwardIp(req.headers),
      },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });
  } catch {
    return fail('Cannot reach the CivicLens API.', 502);
  }

  if (login.status === 429) {
    return fail(
      'Too many attempts — wait a minute and try again.',
      429,
    );
  }

  if (login.status === 401 || login.status === 400) {
    return fail('Invalid email or password.', 401);
  }

  if (!login.ok) {
    return fail('Sign-in failed. Try again shortly.', 502);
  }

  const tokens = (await login.json()) as Tokens;

  // Dashboard access is staff-only.
  // The API enforces roles on every call too.
  const meRes = await fetch(`${API_V1}/auth/me`, {
    headers: {
      authorization: `Bearer ${tokens.accessToken}`,
    },
    cache: 'no-store',
  }).catch(() => null);

  const me = meRes?.ok
    ? ((await meRes.json()) as {
        displayName: string;
        role: string;
      })
    : null;

  if (!me || !(STAFF_ROLES as readonly string[]).includes(me.role)) {
    // Don't leave a live session behind for an account
    // that cannot use the dashboard.
    await fetch(`${API_V1}/auth/logout`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        refreshToken: tokens.refreshToken,
      }),
      cache: 'no-store',
    }).catch(() => undefined);

    return fail(
      'This account does not have dashboard access.',
      403,
    );
  }

  const res = NextResponse.json(
    {
      ok: true,
      name: me.displayName,
      role: me.role,
    },
    {
      headers: { 'cache-control': 'no-store' },
    },
  );

  applySession(res, tokens);

  return res;
}
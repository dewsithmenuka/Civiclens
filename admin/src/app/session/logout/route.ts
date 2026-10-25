import { NextResponse, type NextRequest } from 'next/server';
import { API_V1, APP_ORIGIN, REFRESH_COOKIE } from '@/lib/config';
import { checkSameOrigin } from '@/lib/csrf';
import { clearSession } from '@/lib/session';

export async function POST(req: NextRequest) {
  if (!checkSameOrigin(req.headers, APP_ORIGIN)) return NextResponse.json({ error: 'Cross-origin request refused.' }, { status: 403 });

  // Revoke the whole session family on the API, best effort — we clear our cookies regardless.
  const refreshToken = req.cookies.get(REFRESH_COOKIE)?.value;
  if (refreshToken) {
    await fetch(`${API_V1}/auth/logout`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }), cache: 'no-store',
    }).catch(() => undefined);
  }
  const res = NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
  clearSession(res);
  return res;
}
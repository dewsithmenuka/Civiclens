import type { NextResponse } from 'next/server';
import {
  ACCESS_COOKIE, ACCESS_MAX_AGE, COOKIE_SECURE, FRESH_COOKIE, REFRESH_COOKIE, REFRESH_MAX_AGE, SESSION_COOKIE,
} from './config';

export interface Tokens { accessToken: string; refreshToken: string }

const base = { httpOnly: true, secure: COOKIE_SECURE } as const;

export function applySession(res: NextResponse, t: Tokens) {
  res.cookies.set(ACCESS_COOKIE, t.accessToken, { ...base, sameSite: 'lax', path: '/', maxAge: ACCESS_MAX_AGE });
  // The refresh token is the crown jewel: strict same-site, and only ever sent to /session/*.
  res.cookies.set(REFRESH_COOKIE, t.refreshToken, { ...base, sameSite: 'strict', path: '/session', maxAge: REFRESH_MAX_AGE });
  res.cookies.set(SESSION_COOKIE, '1', { ...base, sameSite: 'lax', path: '/', maxAge: REFRESH_MAX_AGE });
}

export function markFresh(res: NextResponse) {
  res.cookies.set(FRESH_COOKIE, '1', { ...base, sameSite: 'lax', path: '/', maxAge: 10 });
}

export function clearSession(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, '', { ...base, sameSite: 'lax', path: '/', maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, '', { ...base, sameSite: 'strict', path: '/session', maxAge: 0 });
  res.cookies.set(SESSION_COOKIE, '', { ...base, sameSite: 'lax', path: '/', maxAge: 0 });
}
import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ACCESS_COOKIE, API_V1, FRESH_COOKIE } from './config';

/** Where to come back to after a refresh: middleware stores the current path in `x-pathname`. */
async function here(): Promise<string> {
  return (await headers()).get('x-pathname') ?? '/queue';
}

/**
 * Server-side GET against the API using the httpOnly access cookie (never exposed to browser JS).
 * 401 → silent refresh via /session/refresh (unless we *just* refreshed — then give up to avoid a loop).
 * 403 → staff access was revoked. 404 → Next's notFound().
 */
export async function apiGet<T>(path: string): Promise<T> {
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  const next = encodeURIComponent(await here());
  const justRefreshed = jar.get(FRESH_COOKIE)?.value === '1';
  if (!token) redirect(justRefreshed ? '/login?error=session' : `/session/refresh?next=${next}`);

  let res: Response;
  try {
    res = await fetch(`${API_V1}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    throw new Error('The CivicLens API is unreachable. Is it running?');
  }
  if (res.status === 401) redirect(justRefreshed ? '/login?error=session' : `/session/refresh?next=${next}`);
  if (res.status === 403) redirect('/login?error=forbidden');
  if (res.status === 404) notFound();
  if (!res.ok) throw new Error(`The API answered ${res.status}`);
  return (await res.json()) as T;
}
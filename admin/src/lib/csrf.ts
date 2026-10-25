/**
 * CSRF defence for state-changing requests (defence in depth on top of SameSite cookies):
 *  - the browser's Fetch-Metadata header must not say cross-site / same-site
 *  - an Origin header must be present and match this dashboard
 */
export function checkSameOrigin(headers: Headers, appOrigin?: string): boolean {
  const site = headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = headers.get('origin');
  if (!origin) return false;
  if (appOrigin) return origin === appOrigin;
  const host = headers.get('x-forwarded-host') ?? headers.get('host');
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** A cross-site <form> can't send application/json without a CORS preflight, so requiring it blocks form-based CSRF. */
export const isJsonRequest = (headers: Headers): boolean =>
  (headers.get('content-type') ?? '').toLowerCase().startsWith('application/json');
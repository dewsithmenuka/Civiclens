const IP = /^[0-9a-fA-F:.]{3,45}$/;

/** The visitor's IP as reported by YOUR edge proxy (it must overwrite X-Forwarded-For, never append to a client-supplied one). */
export function clientIp(headers: Headers): string | null {
  const first = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (first && IP.test(first)) return first;
  const real = headers.get('x-real-ip')?.trim();
  return real && IP.test(real) ? real : null;
}

/** Headers to add to server-to-API calls so the API rate-limits the real visitor, not the dashboard server. */
export function forwardIp(headers: Headers): Record<string, string> {
  const ip = clientIp(headers);
  return ip ? { 'x-forwarded-for': ip } : {};
}
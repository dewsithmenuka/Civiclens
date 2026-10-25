/** Reads the `exp` claim WITHOUT verifying the signature — only used to decide whether to refresh early. The API verifies for real. */
export function jwtExpiry(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    const exp = JSON.parse(json).exp;
    return typeof exp === 'number' ? exp : null;
  } catch {
    return null;
  }
}

/** True when the token is unreadable, already expired, or expires within `skewSeconds`. */
export function isExpiringSoon(token: string, skewSeconds = 30, nowMs = Date.now()): boolean {
  const exp = jwtExpiry(token);
  return exp === null || exp * 1000 - nowMs < skewSeconds * 1000;
}
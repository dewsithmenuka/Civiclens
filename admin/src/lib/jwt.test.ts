import { describe, expect, it } from 'vitest';
import { isExpiringSoon, jwtExpiry } from './jwt';

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (exp?: number) => `${b64({ alg: 'HS256' })}.${b64(exp === undefined ? { sub: 'x' } : { sub: 'x', exp })}.sig`;
const NOW = 1_800_000_000_000;

describe('jwt helpers', () => {
  it('reads exp', () => expect(jwtExpiry(token(1_800_000_900))).toBe(1_800_000_900));
  it('returns null for garbage or missing exp', () => {
    expect(jwtExpiry('nope')).toBeNull();
    expect(jwtExpiry('a.b.c')).toBeNull();
    expect(jwtExpiry(token())).toBeNull();
  });
  it('treats unreadable tokens as expiring (forces a refresh rather than trusting them)', () => {
    expect(isExpiringSoon('garbage', 30, NOW)).toBe(true);
  });
  it('flags expired tokens and tokens inside the skew window', () => {
    expect(isExpiringSoon(token(NOW / 1000 - 1), 30, NOW)).toBe(true);
    expect(isExpiringSoon(token(NOW / 1000 + 10), 30, NOW)).toBe(true);
    expect(isExpiringSoon(token(NOW / 1000 + 29), 30, NOW)).toBe(true);
  });
  it('leaves comfortably valid tokens alone', () => {
    expect(isExpiringSoon(token(NOW / 1000 + 600), 30, NOW)).toBe(false);
  });
});
import { describe, expect, it, vi } from 'vitest';
import { clientIp, forwardIp } from './client-ip';

const h = (o: Record<string, string>) => new Headers(o);

describe('clientIp', () => {
  it('takes the first X-Forwarded-For entry', () => expect(clientIp(h({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }))).toBe('203.0.113.7'));
  it('falls back to X-Real-IP, and supports IPv6', () => {
    expect(clientIp(h({ 'x-real-ip': '198.51.100.4' }))).toBe('198.51.100.4');
    expect(clientIp(h({ 'x-forwarded-for': '2001:db8::1' }))).toBe('2001:db8::1');
  });
  it('rejects garbage so it can never inject into a header', () => {
    const malformed = new Headers();
    vi.spyOn(malformed, 'get').mockReturnValue('evil\r\nX-Admin: 1');
    expect(clientIp(malformed)).toBeNull();
    expect(clientIp(h({ 'x-forwarded-for': '<script>' }))).toBeNull();
    expect(clientIp(h({}))).toBeNull();
  });
  it('forwardIp returns nothing when there is no IP (local development)', () => {
    expect(forwardIp(h({}))).toEqual({});
    expect(forwardIp(h({ 'x-forwarded-for': '1.2.3.4' }))).toEqual({ 'x-forwarded-for': '1.2.3.4' });
  });
});
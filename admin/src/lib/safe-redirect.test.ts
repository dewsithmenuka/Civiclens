import { describe, expect, it } from 'vitest';
import { safeNext } from './safe-redirect';

describe('safeNext (open-redirect protection)', () => {
  it('keeps ordinary in-app paths, including query strings', () => {
    expect(safeNext('/queue')).toBe('/queue');
    expect(safeNext('/queue?status=REPORTED&page=2')).toBe('/queue?status=REPORTED&page=2');
    expect(safeNext('/issues/3f2a')).toBe('/issues/3f2a');
  });
  it('falls back for missing / empty / non-string input', () => {
    expect(safeNext(null)).toBe('/queue');
    expect(safeNext(undefined)).toBe('/queue');
    expect(safeNext('')).toBe('/queue');
    expect(safeNext(42 as unknown as string)).toBe('/queue');
  });
  it.each([
    'https://evil.example.com',
    'http://evil.example.com/queue',
    '//evil.example.com',
    '//evil.example.com/queue',
    '/\\evil.example.com',
    '\\\\evil.example.com',
    'javascript:alert(1)',
    'queue',
    '/queue\nSet-Cookie: x=1',
    '/queue\r\n',
    '/%2f%2fevil.example.com'.replace('%2f', '/'),
  ])('rejects %j', (bad) => {
    expect(safeNext(bad)).toBe('/queue');
  });
  it('never redirects back into the auth endpoints (no loops)', () => {
    expect(safeNext('/login')).toBe('/queue');
    expect(safeNext('/login?next=/queue')).toBe('/queue');
    expect(safeNext('/session/refresh?next=/queue')).toBe('/queue');
    expect(safeNext('/session/logout')).toBe('/queue');
  });
  it('rejects absurdly long input and honours a custom fallback', () => {
    expect(safeNext('/' + 'a'.repeat(3000))).toBe('/queue');
    expect(safeNext('https://evil.example.com', '/stats')).toBe('/stats');
  });
});
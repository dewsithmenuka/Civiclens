import { describe, expect, it } from 'vitest';
import { formatDuration, timeAgo } from './format';

describe('formatDuration', () => {
  it.each([
    [null, '—'], [undefined, '—'], [Number.NaN, '—'],
    [0, '0 min'], [0.4, '24 min'], [0.99, '59 min'],
    [1, '1 h'], [3.46, '3.5 h'], [24, '24 h'], [47.9, '47.9 h'],
    [48, '2 days'], [96, '4 days'], [100, '4.2 days'],
  ])('formatDuration(%s) = %s', (input, expected) => expect(formatDuration(input as number | null)).toBe(expected));
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-18T12:00:00Z');
  it.each([
    ['2026-10-18T11:59:50Z', 'just now'], ['2026-10-18T11:30:00Z', '30 min ago'], ['2026-10-18T09:00:00Z', '3 h ago'],
    ['2026-10-15T12:00:00Z', '3 d ago'], ['2026-09-01T12:00:00Z', '2026-09-01'],
  ])('%s → %s', (iso, expected) => expect(timeAgo(iso, now)).toBe(expected));
  it('never goes negative for timestamps slightly in the future (clock skew)', () => {
    expect(timeAgo('2026-10-18T12:00:05Z', now)).toBe('just now');
  });
});
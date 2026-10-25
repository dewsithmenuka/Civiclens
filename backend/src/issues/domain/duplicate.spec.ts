import { haversineM, isPossibleDuplicate } from './duplicate';

const base = { category: 'ROADS', lat: 40.7128, lng: -74.006, createdAt: new Date('2026-10-01T12:00:00Z') };
const opts = { radiusM: 50, windowHours: 24 };

describe('duplicate signal', () => {
  it('haversine ≈ 111 m per 0.001° latitude', () => {
    const d = haversineM({ lat: 40, lng: 0 }, { lat: 40.001, lng: 0 });
    expect(d).toBeGreaterThan(110);
    expect(d).toBeLessThan(112);
  });
  it('flags same category, close, recent', () => {
    expect(isPossibleDuplicate(base, { ...base, lat: base.lat + 0.0002, createdAt: new Date('2026-10-01T20:00:00Z') }, opts)).toBe(true);
  });
  it('ignores different categories', () => {
    expect(isPossibleDuplicate(base, { ...base, category: 'WATER' }, opts)).toBe(false);
  });
  it('ignores far away reports', () => {
    expect(isPossibleDuplicate(base, { ...base, lat: base.lat + 0.001 }, opts)).toBe(false); // ~111 m
  });
  it('ignores reports outside the time window', () => {
    expect(isPossibleDuplicate(base, { ...base, createdAt: new Date('2026-10-03T12:00:00Z') }, opts)).toBe(false);
  });
});

export interface Candidate { category: string; lat: number; lng: number; createdAt: Date }

const R = 6_371_008.8; // mean Earth radius (m)
const rad = (d: number) => (d * Math.PI) / 180;

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Deterministic duplicate *signal*: same category, within radius, within time window.
 * Mirrors the SQL in IssuesRepository.findDuplicateCandidate — kept as a pure function so the
 * rule is unit-testable and documented in one place. It never deletes anything; it only flags.
 */
export function isPossibleDuplicate(
  a: Candidate,
  b: Candidate,
  opts: { radiusM: number; windowHours: number },
): boolean {
  if (a.category !== b.category) return false;
  const hours = Math.abs(a.createdAt.getTime() - b.createdAt.getTime()) / 3_600_000;
  return hours <= opts.windowHours && haversineM(a, b) <= opts.radiusM;
}

export const STATUS_LABEL: Record<string, string> = {
  REPORTED: 'Reported', UNDER_REVIEW: 'Under review', ACKNOWLEDGED: 'Acknowledged',
  IN_PROGRESS: 'In progress', RESOLVED: 'Resolved', DUPLICATE: 'Duplicate', REJECTED: 'Rejected',
};

export const CATEGORY_LABEL: Record<string, string> = {
  ROADS: 'Roads', LIGHTING: 'Lighting', WATER: 'Water', WASTE: 'Waste', TRAFFIC: 'Traffic', ACCESSIBILITY: 'Accessibility',
};

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toISOString().slice(0, 10);
}

/** Durations for KPIs: 0.4 → "24 min", 3.46 → "3.5 h", 96 → "4 days". */
export function formatDuration(hours: number | null | undefined): string {
  if (hours === null || hours === undefined || Number.isNaN(hours)) return '—';
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

export const ROLE_LABEL: Record<string, string> = { USER: 'User', MODERATOR: 'Moderator', ADMIN: 'Admin' };
export const ACCOUNT_STATUS_LABEL: Record<string, string> = { ACTIVE: 'Active', SUSPENDED: 'Suspended', DELETED: 'Deleted' };
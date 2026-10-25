
/**
 * Shared contracts: the single source of truth for enums, event names and
 * wire-level types used by the API, the admin dashboard and (mirrored in Dart)
 * the mobile app.
 */

export enum Role {
  USER = 'USER',
  MODERATOR = 'MODERATOR',
  ADMIN = 'ADMIN',
}

export enum IssueStatus {
  REPORTED = 'REPORTED',
  UNDER_REVIEW = 'UNDER_REVIEW',
  ACKNOWLEDGED = 'ACKNOWLEDGED',
  IN_PROGRESS = 'IN_PROGRESS',
  RESOLVED = 'RESOLVED',
  DUPLICATE = 'DUPLICATE',
  REJECTED = 'REJECTED',
}

/**
 * The issue lifecycle as data — the single source of truth shared by the API (which enforces it)
 * and the dashboard (which only offers legal actions).
 *
 *   REPORTED → UNDER_REVIEW → ACKNOWLEDGED → IN_PROGRESS → RESOLVED
 *   REPORTED | UNDER_REVIEW → DUPLICATE | REJECTED   (terminal)
 */
export const ISSUE_TRANSITIONS: Readonly<
  Record<IssueStatus, readonly IssueStatus[]>
> = {
  [IssueStatus.REPORTED]: [
    IssueStatus.UNDER_REVIEW,
    IssueStatus.DUPLICATE,
    IssueStatus.REJECTED,
  ],
  [IssueStatus.UNDER_REVIEW]: [
    IssueStatus.ACKNOWLEDGED,
    IssueStatus.DUPLICATE,
    IssueStatus.REJECTED,
  ],
  [IssueStatus.ACKNOWLEDGED]: [IssueStatus.IN_PROGRESS],
  [IssueStatus.IN_PROGRESS]: [IssueStatus.RESOLVED],
  [IssueStatus.RESOLVED]: [],
  [IssueStatus.DUPLICATE]: [],
  [IssueStatus.REJECTED]: [],
};

export const ISSUE_CATEGORIES = [
  'ROADS',
  'LIGHTING',
  'WATER',
  'WASTE',
  'TRAFFIC',
  'ACCESSIBILITY',
] as const;

export type IssueCategory = (typeof ISSUE_CATEGORIES)[number];

export const REALTIME_EVENTS = {
  ISSUE_CREATED: 'issue.created',
  ISSUE_UPDATED: 'issue.updated',
  ISSUE_STATUS_CHANGED: 'issue.status_changed',
  ISSUE_CONFIRMED: 'issue.confirmed',
  ISSUE_RESOLVED: 'issue.resolved',
} as const;

export type RealtimeEvent =
  (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

/** Client → server message to (re)subscribe to issues inside the visible map viewport. */
export const VIEWPORT_SUBSCRIBE = 'viewport.subscribe';

export interface BBox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface LatLng {
  lat: number;
  lng: number;
}

export interface IssueView {
  id: string;
  category: IssueCategory;
  title: string;
  description: string | null;
  status: IssueStatus;
  confirmationCount: number;
  possibleDuplicateOf: string | null;

  /** Public responses are snapped to a ~55 m grid; only moderators see EXACT. */
  location: LatLng;
  locationPrecision: 'APPROXIMATE' | 'EXACT';

  distanceM?: number;
  createdAt: string;
  updatedAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

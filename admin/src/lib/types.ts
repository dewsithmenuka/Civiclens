import type { IssueStatus } from '@civiclens/contracts';

export interface Me { id: string; email: string; displayName: string; role: 'USER' | 'MODERATOR' | 'ADMIN'; emailVerified: boolean }

export interface AdminIssueSummary {
  id: string; category: string; title: string; description: string | null; status: IssueStatus;
  confirmationCount: number; possibleDuplicateOf: string | null;
  assignee: AdminAssignee | null;
  location: { lat: number; lng: number }; reporter: { id: string; displayName: string };
  imageCount: number; createdAt: string; updatedAt: string;
}
export interface Page<T> { items: T[]; total: number; limit: number; offset: number }

export interface AdminIssueDetail {
  id: string; category: string; title: string; description: string | null; status: IssueStatus;
  confirmationCount: number; followerCount: number; location: { lat: number; lng: number };
  reporter: { id: string; displayName: string };
  assignee: AdminAssignee | null;
  createdAt: string; updatedAt: string; resolvedAt: string | null;
  images: { id: string; url: string; width: number; height: number }[];
  timeline: { from: IssueStatus | null; to: IssueStatus; note: string | null; at: string; actor: { displayName: string; role: string } | null }[];
  audit: AdminIssueAudit[];
  possibleDuplicate: null | {
    id: string; title: string; status: IssueStatus; category: string; confirmationCount: number;
    distanceM: number; location: { lat: number; lng: number }; createdAt: string;
  };
  duplicatesOfThis: { id: string; title: string; status: IssueStatus; createdAt: string }[];
}

export interface AdminAssignee { id: string; displayName: string; role: Role }
export interface AdminIssueAudit {
  id: number; action: string; metadata: Record<string, unknown> | null; at: string;
  actor: { displayName: string; role: string } | null;
}

export interface AdminStats {
  byStatus: Record<string, number>;
  byCategory: { category: string; count: number }[];
  totalIssues: number;
  queue: { open: number; flaggedDuplicates: number; oldestUnreviewedHours: number };
  last14Days: { day: string; created: number; resolved: number }[];
  resolution: { medianHours: number | null; sampleSize: number; windowDays: number };
}

export type Role = 'USER' | 'MODERATOR' | 'ADMIN';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED';

export interface AdminUser {
  id: string; email: string; displayName: string; role: Role; status: AccountStatus;
  emailVerified: boolean; issueCount: number; createdAt: string;
}

export interface AuditEntry {
  id: number; action: string; entityType: string; entityId: string;
  metadata: Record<string, unknown> | null;
  actor: { displayName: string; role: string } | null; at: string;
}

export interface HeatCell { lat: number; lng: number; count: number; openCount: number; oldestOpenHours: number }
export interface Hotspot { lat: number; lng: number; openCount: number; topCategory: string; oldestHours: number; confirmations: number }
export interface HeatmapResponse {
  cellDegrees: number; scope: 'open' | 'resolved' | 'all'; days: number; category: string | null;
  totalReports: number; maxCount: number; truncated: boolean; cells: HeatCell[]; hotspots: Hotspot[];
}
export interface Insights {
  backlogAge: { key: string; label: string; count: number }[];
  resolutionByCategory: { category: string; resolved: number; open: number; medianHours: number | null }[];
}
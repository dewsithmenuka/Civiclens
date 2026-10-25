export const API_URL = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
export const API_V1 = `${API_URL}/api/v1`;

/** Optional: exact origin of this dashboard. When set, state-changing requests must come from it. */
export const APP_ORIGIN = process.env.APP_ORIGIN || undefined;

export const COOKIE_SECURE = process.env.COOKIE_SECURE
  ? process.env.COOKIE_SECURE === 'true'
  : process.env.NODE_ENV === 'production';

/** httpOnly cookies — none of these is ever readable by JavaScript in the browser. */
export const ACCESS_COOKIE = 'cl_at';   // short-lived access token
export const REFRESH_COOKIE = 'cl_rt';  // refresh token, only sent to /session/*
export const SESSION_COOKIE = 'cl_s';   // marker: "a session exists", lets middleware skip a pointless refresh hop
export const FRESH_COOKIE = 'cl_fresh'; // set for 10 s after a refresh to break any redirect loop

export const ACCESS_MAX_AGE = 15 * 60;
export const REFRESH_MAX_AGE = 30 * 24 * 3600;

export const STAFF_ROLES = ['MODERATOR', 'ADMIN'] as const;
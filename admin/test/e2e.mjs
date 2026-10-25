/**
 * End-to-end test of the dashboard + its security properties, driven over real HTTP like a browser would
 * (cookie jar, manual redirects). Needs the API and the dashboard running, plus ONE existing ADMIN account:
 *
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... node --test test/e2e.mjs
 *
 * Optional: API_URL (default http://localhost:3000), ADMIN_URL (default http://localhost:3001),
 *           E2E_EXPECT_SECURE=true if the dashboard runs over HTTPS (cookies must then carry the Secure flag).
 *
 * Start the API with NODE_ENV=test so its per-IP rate limits (10 logins/min) don't throttle the suite,
 * and the dashboard with COOKIE_SECURE=false when serving plain HTTP locally.
 * Everything else (reporter, moderator, issues) the script creates itself through the API.
 */
import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';

const API = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/$/, '') + '/api/v1';
const ADMIN = (process.env.ADMIN_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('Set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD (an existing ADMIN account).');

const tag = Math.random().toString(36).slice(2, 8);
const PW = 'correct-horse-battery';

// ───────── a tiny browser: cookie jar with path scoping, manual redirects ─────────
class Browser {
  constructor() { this.cookies = new Map(); }
  ingest(res) {
    for (const sc of res.headers.getSetCookie()) {
      const [pair, ...attrs] = sc.split(';').map((s) => s.trim());
      const i = pair.indexOf('=');
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      const a = Object.fromEntries(attrs.map((x) => { const j = x.indexOf('='); return j < 0 ? [x.toLowerCase(), true] : [x.slice(0, j).toLowerCase(), x.slice(j + 1)]; }));
      const path = a.path ?? '/';
      if (value === '' || a['max-age'] === '0') this.cookies.delete(`${name}|${path}`);
      else this.cookies.set(`${name}|${path}`, { name, value, path, attrs: a });
    }
  }
  cookie(name) { return [...this.cookies.values()].find((c) => c.name === name); }
  setCookie(name, value, path = '/') { this.cookies.set(`${name}|${path}`, { name, value, path, attrs: {} }); }
  header(pathname) {
    return [...this.cookies.values()].filter((c) => pathname.startsWith(c.path)).map((c) => `${c.name}=${c.value}`).join('; ');
  }
  async fetch(path, { method = 'GET', headers = {}, body, origin } = {}) {
    const h = { ...headers };
    const cookie = this.header(new URL(path, ADMIN).pathname);
    if (cookie) h.cookie = cookie;
    if (origin !== undefined) h.origin = origin;
    const res = await fetch(ADMIN + path, { method, headers: h, body, redirect: 'manual' });
    this.ingest(res);
    return res;
  }
  json(path, method, payload, origin = ADMIN) {
    return this.fetch(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), origin });
  }
  async login(email, password) { return this.json('/session/login', 'POST', { email, password }); }
}

// ───────── API helpers (setup only) ─────────
async function api(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const register = async (name) => {
  const email = `e2e-${name}-${tag}@example.com`;
  const r = await api('/auth/register', { method: 'POST', body: { email, password: PW, displayName: `E2E ${name}` } });
  assert.equal(r.status, 201, `register ${name}: ${JSON.stringify(r.body)}`);
  return { email, token: r.body.accessToken };
};

const lat = 55 + Math.random(), lng = 12 + Math.random();
const location = (n) => ({ latitude: lat + n, longitude: lng + n });
let adminToken, reporter, mod, original, dup, other;
const locHeader = (res) => res.headers.get('location') ?? '';

before(async () => {
  const a = await api('/auth/login', { method: 'POST', body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } });
  assert.equal(a.status, 200, 'cannot log in as the admin account');
  adminToken = a.body.accessToken;
  assert.equal((await api('/auth/me', { token: adminToken })).body.role, 'ADMIN', 'E2E_ADMIN_EMAIL must be an ADMIN');

  reporter = await register('reporter');
  mod = await register('mod');
  const found = await api(`/admin/users?search=${encodeURIComponent(mod.email)}`, { token: adminToken });
  mod.id = found.body.items[0].id;
  assert.equal((await api(`/admin/users/${mod.id}`, { method: 'PATCH', token: adminToken, body: { role: 'MODERATOR' } })).status, 200);

  const create = async (title, n, category = 'ROADS') =>
    (await api('/issues', { method: 'POST', token: reporter.token, body: { category, title, ...location(n) } })).body;
  original = await create(`Original pothole ${tag}`, 0);
  const second = await register('second');
  dup = (await api('/issues', { method: 'POST', token: second.token, body: { category: 'ROADS', title: `Same pothole ${tag}`, latitude: lat + 0.0002, longitude: lng } })).body;
  other = await create(`Unrelated lamp ${tag}`, 5, 'LIGHTING');
});

describe('unauthenticated visitors', () => {
  it('are redirected from protected pages to the login page, remembering where they were going', async () => {
    const res = await new Browser().fetch('/queue?status=REPORTED');
    assert.equal(res.status, 307);
    assert.match(locHeader(res), /\/login\?next=%2Fqueue%3Fstatus%3DREPORTED$/);
  });
  it('get the login page with a nonce-based CSP, anti-framing headers, and nonce-stamped scripts', async () => {
    const res = await new Browser().fetch('/login');
    assert.equal(res.status, 200);
    const csp = res.headers.get('content-security-policy');
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    assert.ok(nonce, 'CSP must carry a per-request nonce');
    assert.match(csp, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
    assert.doesNotMatch(csp.match(/script-src[^;]*/)[0], /unsafe-inline/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
    const html = await res.text();
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(scripts.length > 0);
    assert.ok(scripts.every((s) => s.includes(`nonce="${nonce}"`)), `every script tag must carry the nonce:\n${scripts.join('\n')}`);
    const second = await (await new Browser().fetch('/login')).headers.get('content-security-policy');
    assert.notEqual(/'nonce-([^']+)'/.exec(second)[1], nonce, 'the nonce must change on every request');
  });
  it('cannot use the BFF proxy without a session', async () => {
    assert.equal((await new Browser().fetch('/api/bff/admin/stats')).status, 401);
  });
});

describe('signing in', () => {
  it('refuses cross-origin, missing-origin, and non-JSON attempts', async () => {
    const b = new Browser();
    const body = JSON.stringify({ email: mod.email, password: PW });
    const json = { 'content-type': 'application/json' };
    assert.equal((await b.fetch('/session/login', { method: 'POST', headers: json, body, origin: 'https://evil.example.com' })).status, 403);
    assert.equal((await b.fetch('/session/login', { method: 'POST', headers: json, body })).status, 403, 'no Origin header');
    assert.equal((await b.fetch('/session/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `email=${mod.email}&password=${PW}`, origin: ADMIN })).status, 415);
    assert.equal(b.cookies.size, 0);
  });
  it('rejects bad credentials with a generic message and sets no cookies', async () => {
    const b = new Browser();
    const res = await b.login(mod.email, 'definitely-wrong-password');
    assert.equal(res.status, 401);
    assert.equal((await res.json()).error, 'Invalid email or password.');
    assert.equal(b.cookies.size, 0);
    assert.equal((await b.login(`nobody-${tag}@example.com`, PW)).status, 401);
  });
  it('rejects a valid but non-staff account, and leaves no live session behind', async () => {
    const b = new Browser();
    const res = await b.login(reporter.email, PW);
    assert.equal(res.status, 403);
    assert.match((await res.json()).error, /dashboard access/);
    assert.equal(b.cookies.size, 0);
    const refreshTokens = await api('/auth/login', { method: 'POST', body: { email: reporter.email, password: PW } });
    assert.equal(refreshTokens.status, 200, 'the account itself still works for the app');
  });
  it('accepts a moderator: httpOnly cookies, tokens never in the response body, refresh token scoped to /session', async () => {
    const b = new Browser();
    const res = await b.login(mod.email, PW);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.doesNotMatch(text, /accessToken|refreshToken|eyJ/, 'no token may reach browser JavaScript');
    assert.deepEqual(JSON.parse(text), { ok: true, name: 'E2E mod', role: 'MODERATOR' });
    const raw = res.headers.getSetCookie().join('\n');
    const at = b.cookie('cl_at'), rt = b.cookie('cl_rt');
    assert.ok(at && rt, 'access + refresh cookies set');
    assert.ok(at.attrs.httponly && rt.attrs.httponly, 'both httpOnly');
    assert.equal(at.attrs.samesite?.toLowerCase(), 'lax');
    assert.equal(rt.attrs.samesite?.toLowerCase(), 'strict');
    assert.equal(rt.path, '/session', 'refresh token only travels to /session/*');
    assert.equal(b.header('/queue').includes('cl_rt'), false, 'refresh token is NOT sent with page requests');
    assert.equal(b.header('/api/bff/admin/stats').includes('cl_rt'), false, 'nor with proxy requests');
    assert.ok(b.header('/session/refresh').includes('cl_rt'));
    assert.equal(/;\s*secure/i.test(raw), process.env.E2E_EXPECT_SECURE === 'true', 'Secure flag must match the deployment (HTTPS → on)');
  });
});

describe('the moderation queue', () => {
  let b;
  before(async () => { b = new Browser(); assert.equal((await b.login(mod.email, PW)).status, 200); });

  it('renders reports server-side, with filters applied from the URL', async () => {
    const res = await b.fetch(`/queue?q=${encodeURIComponent(`pothole ${tag}`)}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(`Original pothole ${tag}`));
    assert.match(html, new RegExp(`Same pothole ${tag}`));
    assert.doesNotMatch(html, new RegExp(`Unrelated lamp ${tag}`));
    assert.match(html, /possible duplicate/i, 'the near-duplicate is flagged');
    assert.match(html, /2 reports match your filters/);
  });
  it('filters by category and by the duplicate flag', async () => {
    const lamp = await (await b.fetch(`/queue?category=LIGHTING&q=${tag}`)).text();
    assert.match(lamp, new RegExp(`Unrelated lamp ${tag}`));
    assert.doesNotMatch(lamp, new RegExp(`Original pothole ${tag}`));
    const flagged = await (await b.fetch(`/queue?flagged=1&q=${tag}`)).text();
    assert.match(flagged, new RegExp(`Same pothole ${tag}`));
    assert.doesNotMatch(flagged, new RegExp(`Original pothole ${tag}`));
  });
  it('shows a friendly empty state, and ignores junk query values instead of crashing', async () => {
    assert.match(await (await b.fetch(`/queue?q=zzz-no-such-report-${tag}`)).text(), /Nothing here/);
    const junk = await b.fetch('/queue?status=NOPE&category=%00&sort=;DROP&page=-5&flagged=maybe');
    assert.equal(junk.status, 200);
  });
  it('escapes report content (no HTML injection from a malicious title)', async () => {
    const evil = `<img src=x onerror=alert(1)> ${tag}`;
    await api('/issues', { method: 'POST', token: reporter.token, body: { category: 'WASTE', title: evil, ...location(9) } });
    const html = await (await b.fetch(`/queue?q=${encodeURIComponent(tag)}&category=WASTE`)).text();
    assert.doesNotMatch(html, /<img src=x onerror/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  });
});

describe('issue detail and moderation actions', () => {
  let b;
  before(async () => { b = new Browser(); assert.equal((await b.login(mod.email, PW)).status, 200); });
  const status = (id, body, origin = ADMIN) => b.json(`/api/bff/admin/issues/${id}/status`, 'PATCH', body, origin);

  it('shows exact location, timeline, the duplicate candidate and the moderation panel', async () => {
    const res = await b.fetch(`/issues/${dup.id}`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, new RegExp(`Same pothole ${tag}`));
    assert.match(html, /Possible duplicate/);
    assert.match(html, new RegExp(`Original pothole ${tag}`));
    assert.match(html, /E2E second/);
    assert.match(html, new RegExp(`${(lat + 0.0002).toFixed(5)}`), 'exact coordinates, not the rounded public ones');
    assert.match(html, /Moderation/);
  });
  it('404s on malformed and unknown ids', async () => {
    assert.equal((await b.fetch('/issues/not-a-uuid')).status, 404);
    assert.equal((await b.fetch('/issues/00000000-0000-4000-8000-000000000000')).status, 404);
  });
  it('proxy: only allow-listed /admin routes are reachable, with the right methods', async () => {
    assert.equal((await b.fetch('/api/bff/auth/me')).status, 404);
    assert.equal((await b.fetch('/api/bff/issues')).status, 404);
    assert.equal((await b.fetch('/api/bff/admin/../auth/me')).status, 404);
    assert.equal((await b.json('/api/bff/admin/issues', 'PATCH', {})).status, 404);
    const ok = await b.fetch('/api/bff/admin/stats');
    assert.equal(ok.status, 200);
    assert.ok((await ok.json()).queue);
    assert.equal(ok.headers.get('cache-control'), 'no-store');
  });
  it('proxy mutations are CSRF-protected', async () => {
    assert.equal((await status(other.id, { status: 'UNDER_REVIEW' }, 'https://evil.example.com')).status, 403);
    assert.equal((await b.fetch(`/api/bff/admin/issues/${other.id}/status`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"status":"UNDER_REVIEW"}' })).status, 403, 'no Origin');
    assert.equal((await b.fetch(`/api/bff/admin/issues/${other.id}/status`, { method: 'PATCH', headers: { 'content-type': 'text/plain' }, body: '{"status":"UNDER_REVIEW"}', origin: ADMIN })).status, 415);
    const still = await api(`/issues/${other.id}`);
    assert.equal(still.body.status, 'REPORTED', 'nothing changed');
  });
  it('walks a report through the lifecycle, and the API rejects illegal moves with a readable message', async () => {
    const skip = await status(other.id, { status: 'RESOLVED' });
    assert.equal(skip.status, 400);
    assert.match((await skip.json()).message, /Illegal transition REPORTED → RESOLVED/);
    for (const s of ['UNDER_REVIEW', 'ACKNOWLEDGED', 'IN_PROGRESS']) {
      const r = await status(other.id, { status: s, note: `moving to ${s}` });
      assert.equal(r.status, 200, `${s}`);
    }
    const html = await (await b.fetch(`/issues/${other.id}`)).text();
    assert.match(html, /moving to IN_PROGRESS/);
    assert.match(html, /E2E mod \(moderator\)/);
  });
  it('merges a duplicate into the original', async () => {
    const r = await status(dup.id, { status: 'DUPLICATE', note: 'same hole' });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).mergedInto, original.id);
    assert.equal((await api(`/issues/${dup.id}`)).status, 404, 'hidden from the public');
    assert.equal((await api(`/issues/${original.id}`)).body.confirmationCount, 1, 'the duplicate reporter counts as a confirmation');
    const html = await (await b.fetch(`/issues/${original.id}`)).text();
    assert.match(html, /Reports pointing at this one/);
    assert.match(html, new RegExp(`Same pothole ${tag}`));
  });
  it('fixes a category', async () => {
    const r = await b.json(`/api/bff/admin/issues/${original.id}`, 'PATCH', { category: 'ACCESSIBILITY' });
    assert.equal(r.status, 200);
    assert.equal((await api(`/issues/${original.id}`)).body.category, 'ACCESSIBILITY');
  });
});

describe('session lifecycle', () => {
  it('silently refreshes an expired access token, rotates the refresh token, and kills a replayed one', async () => {
    const b = new Browser();
    assert.equal((await b.login(mod.email, PW)).status, 200);
    const oldRefresh = b.cookie('cl_rt').value;

    // Simulate "the access token expired while the tab was idle".
    const expired = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'x', exp: 1 })).toString('base64url')}.sig`;
    b.setCookie('cl_at', expired);

    const hop1 = await b.fetch('/queue');
    assert.equal(hop1.status, 307);
    assert.match(locHeader(hop1), /\/session\/refresh\?next=%2Fqueue$/);
    const hop2 = await b.fetch('/session/refresh?next=%2Fqueue');
    assert.equal(hop2.status, 307);
    assert.match(locHeader(hop2), /\/queue$/);
    assert.notEqual(b.cookie('cl_rt').value, oldRefresh, 'refresh token rotated');
    assert.notEqual(b.cookie('cl_at').value, expired);
    assert.equal((await b.fetch('/queue')).status, 200, 'and the page now loads');

    // An attacker (or a stale tab) replaying the spent refresh token must not get in — and burns the whole session.
    const thief = new Browser();
    thief.setCookie('cl_rt', oldRefresh, '/session');
    const replay = await thief.fetch('/session/refresh?next=%2Fqueue');
    assert.equal(replay.status, 307);
    assert.match(locHeader(replay), /\/login\?error=session/);
    b.setCookie('cl_at', expired);
    const after = await b.fetch('/session/refresh?next=%2Fqueue');
    assert.match(locHeader(after), /\/login\?error=session/, 'reuse detection revoked the legitimate session too');
  });
  it('the refresh endpoint cannot be abused as an open redirect', async () => {
    for (const evil of ['https://evil.example.com', '//evil.example.com', '/\\evil.example.com', 'javascript:alert(1)']) {
      const b = new Browser();
      assert.equal((await b.login(mod.email, PW)).status, 200);
      const res = await b.fetch(`/session/refresh?next=${encodeURIComponent(evil)}`);
      assert.equal(res.status, 307);
      assert.match(locHeader(res), /^https?:\/\/[^/]+\/queue$/, `${evil} → ${locHeader(res)}`);
      assert.ok(new URL(locHeader(res)).host === new URL(ADMIN).host);
    }
  });
  it('the login page does not echo an off-site `next` into the form', async () => {
    // (Next's internal payload echoes the *requested URL*; what matters is the value handed to the login form.)
    const html = await (await new Browser().fetch(`/login?next=${encodeURIComponent('https://evil.example.com')}`)).text();
    assert.match(html, /next\W{3,8}\/queue\W/, 'the form receives the safe fallback');
    assert.doesNotMatch(html, /next\W{3,8}https?:/, 'never the off-site URL');
  });
  it('signing out revokes the session on the API, clears the cookies, and locks the pages again', async () => {
    const b = new Browser();
    assert.equal((await b.login(mod.email, PW)).status, 200);
    const refresh = b.cookie('cl_rt').value;
    assert.equal((await b.fetch('/session/logout', { method: 'POST', origin: 'https://evil.example.com' })).status, 403, 'logout is CSRF-protected too');
    assert.equal((await b.fetch('/session/logout', { method: 'POST', origin: ADMIN })).status, 200);
    assert.equal(b.cookies.size, 0, 'all cookies cleared');
    assert.equal((await b.fetch('/queue')).status, 307);
    const direct = await fetch(`${API}/auth/refresh`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken: refresh }) });
    assert.equal(direct.status, 401, 'the refresh token is dead on the API, not just forgotten by the browser');
  });
  it('a moderator suspended mid-session is locked out of every page on the next click', async () => {
    const victim = await register('doomed');
    const found = await api(`/admin/users?search=${encodeURIComponent(victim.email)}`, { token: adminToken });
    const id = found.body.items[0].id;
    await api(`/admin/users/${id}`, { method: 'PATCH', token: adminToken, body: { role: 'MODERATOR' } });

    const b = new Browser();
    assert.equal((await b.login(victim.email, PW)).status, 200);
    assert.equal((await b.fetch('/queue')).status, 200);

    assert.equal((await api(`/admin/users/${id}`, { method: 'PATCH', token: adminToken, body: { status: 'SUSPENDED' } })).status, 200);

    const page = await b.fetch('/queue');
    assert.equal(page.status, 307);
    assert.match(locHeader(page), /\/login\?error=forbidden/);
    assert.equal((await b.json(`/api/bff/admin/issues/${other.id}`, 'PATCH', { category: 'WATER' })).status, 403, 'and the proxy refuses writes immediately');
  });
});
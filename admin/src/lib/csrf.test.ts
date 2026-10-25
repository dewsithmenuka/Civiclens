import { describe, expect, it } from 'vitest';
import { checkSameOrigin, isJsonRequest } from './csrf';

const h = (o: Record<string, string>) => new Headers(o);

describe('checkSameOrigin', () => {
  it('accepts a same-origin request (Origin host matches Host)', () => {
    expect(checkSameOrigin(h({ origin: 'http://localhost:3001', host: 'localhost:3001' }))).toBe(true);
    expect(checkSameOrigin(h({ origin: 'https://admin.example.com', host: 'admin.example.com', 'sec-fetch-site': 'same-origin' }))).toBe(true);
  });
  it('rejects a missing Origin (non-browser or stripped)', () => {
    expect(checkSameOrigin(h({ host: 'localhost:3001' }))).toBe(false);
  });
  it('rejects a foreign Origin', () => {
    expect(checkSameOrigin(h({ origin: 'https://evil.example.com', host: 'localhost:3001' }))).toBe(false);
    expect(checkSameOrigin(h({ origin: 'http://localhost:3001.evil.com', host: 'localhost:3001' }))).toBe(false);
  });
  it('rejects cross-site and same-site (sibling subdomain) fetch metadata even if Origin looks right', () => {
    expect(checkSameOrigin(h({ origin: 'http://localhost:3001', host: 'localhost:3001', 'sec-fetch-site': 'cross-site' }))).toBe(false);
    expect(checkSameOrigin(h({ origin: 'http://localhost:3001', host: 'localhost:3001', 'sec-fetch-site': 'same-site' }))).toBe(false);
  });
  it('rejects a malformed Origin', () => {
    expect(checkSameOrigin(h({ origin: 'not a url', host: 'localhost:3001' }))).toBe(false);
  });
  it('honours x-forwarded-host behind a proxy', () => {
    expect(checkSameOrigin(h({ origin: 'https://admin.example.com', host: 'internal:3001', 'x-forwarded-host': 'admin.example.com' }))).toBe(true);
  });
  it('with APP_ORIGIN set, requires an exact match', () => {
    expect(checkSameOrigin(h({ origin: 'https://admin.example.com' }), 'https://admin.example.com')).toBe(true);
    expect(checkSameOrigin(h({ origin: 'https://admin.example.com:8443' }), 'https://admin.example.com')).toBe(false);
    expect(checkSameOrigin(h({ origin: 'http://admin.example.com' }), 'https://admin.example.com')).toBe(false);
  });
});

describe('isJsonRequest', () => {
  it('only accepts application/json (so plain <form> posts are refused)', () => {
    expect(isJsonRequest(h({ 'content-type': 'application/json' }))).toBe(true);
    expect(isJsonRequest(h({ 'content-type': 'application/json; charset=utf-8' }))).toBe(true);
    expect(isJsonRequest(h({ 'content-type': 'application/x-www-form-urlencoded' }))).toBe(false);
    expect(isJsonRequest(h({ 'content-type': 'text/plain' }))).toBe(false);
    expect(isJsonRequest(h({}))).toBe(false);
  });
});
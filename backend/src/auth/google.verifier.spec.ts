import { generateKeyPairSync } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { GoogleTokenVerifier } from './google.verifier';

/** Signs tokens with our own RSA key and hands the matching public key to the verifier — no network needed. */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string;
const CLIENT_ID = 'my-app.apps.googleusercontent.com';

const sign = (claims: object, opts: jwt.SignOptions = {}, key = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string) =>
  jwt.sign(
    { sub: '1234567890', email: 'sam@example.com', email_verified: true, name: 'Sam', ...claims },
    key,
    { algorithm: 'RS256', keyid: 'k1', issuer: 'https://accounts.google.com', audience: CLIENT_ID, expiresIn: '10m', ...opts },
  );

const verifier = new GoogleTokenVerifier([CLIENT_ID, 'ios-client.apps.googleusercontent.com'], async () => ({ k1: pem }));

describe('GoogleTokenVerifier (real verification logic, our own keys)', () => {
  it('accepts a valid token and returns the profile', async () => {
    await expect(verifier.verify(sign({}))).resolves.toEqual({ sub: '1234567890', email: 'sam@example.com', emailVerified: true, name: 'Sam' });
  });
  it('accepts either issuer spelling Google uses', async () => {
    await expect(verifier.verify(sign({}, { issuer: 'accounts.google.com' }))).resolves.toMatchObject({ sub: '1234567890' });
  });
  it('accepts any of our configured client ids (web / iOS / Android)', async () => {
    await expect(verifier.verify(sign({}, { audience: 'ios-client.apps.googleusercontent.com' }))).resolves.toBeDefined();
  });
  it('rejects a token minted for a DIFFERENT app (wrong audience)', async () => {
    await expect(verifier.verify(sign({}, { audience: 'someone-elses-app.apps.googleusercontent.com' }))).rejects.toThrow();
  });
  it('rejects a wrong issuer', async () => {
    await expect(verifier.verify(sign({}, { issuer: 'https://evil.example.com' }))).rejects.toThrow();
  });
  it('rejects a token that expired beyond the 5-minute clock-skew allowance', async () => {
    await expect(verifier.verify(sign({}, { expiresIn: -600 }))).rejects.toThrow();
  });
  it('tolerates up to 5 minutes of clock skew (same as Google\'s own verifyIdToken)', async () => {
    await expect(verifier.verify(sign({}, { expiresIn: -60 }))).resolves.toMatchObject({ sub: '1234567890' });
  });
  it('rejects a token signed with a key Google does not publish', async () => {
    await expect(verifier.verify(sign({}, {}, other.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string))).rejects.toThrow();
  });
  it('rejects a tampered payload', async () => {
    const [h, , s] = sign({}).split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'attacker', email: 'victim@example.com', email_verified: true, iss: 'https://accounts.google.com', aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url');
    await expect(verifier.verify(`${h}.${forged}.${s}`)).rejects.toThrow();
  });
  it('rejects garbage', async () => {
    await expect(verifier.verify('not.a.jwt')).rejects.toThrow();
  });
  it('reports emailVerified=false rather than guessing', async () => {
    await expect(verifier.verify(sign({ email_verified: false }))).resolves.toMatchObject({ emailVerified: false });
  });
});
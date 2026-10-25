import { ServiceUnavailableException } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';
import { getConfig } from '../config';

export interface GoogleProfile { sub: string; email: string; emailVerified: boolean; name?: string }

/** Abstraction so tests can supply identities without calling Google. */
export abstract class GoogleVerifier {
  abstract verify(idToken: string): Promise<GoogleProfile>;
}

const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/**
 * Verifies a Google ID token: RS256 signature against Google's published keys, issuer, expiry,
 * and — critically — that the token was minted for OUR client id(s) (the `aud` claim), so a token
 * issued to some other app can't be replayed against us.
 */
export class GoogleTokenVerifier extends GoogleVerifier {
  private client = new OAuth2Client();
  /** `certs` is injectable so the verification logic can be tested offline with our own keys. */
  constructor(private audiences: string[], private certs?: () => Promise<Record<string, string>>) { super(); }

  async verify(idToken: string): Promise<GoogleProfile> {
    const certs = this.certs ? await this.certs() : (await this.client.getFederatedSignonCertsAsync()).certs;
    const ticket = await this.client.verifySignedJwtWithCertsAsync(idToken, certs, this.audiences, ISSUERS);
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new Error('Google token is missing sub/email');
    return { sub: p.sub, email: p.email, emailVerified: p.email_verified === true, name: p.name };
  }
}

/** Used when GOOGLE_CLIENT_IDS isn't set: the endpoint answers 503 instead of pretending to work. */
export class DisabledGoogleVerifier extends GoogleVerifier {
  async verify(): Promise<GoogleProfile> {
    throw new ServiceUnavailableException('Google sign-in is not configured');
  }
}

export function createGoogleVerifier(): GoogleVerifier {
  const ids = getConfig().googleClientIds;
  return ids.length ? new GoogleTokenVerifier(ids) : new DisabledGoogleVerifier();
}
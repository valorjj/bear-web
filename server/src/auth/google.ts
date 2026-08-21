import type { Claims } from '../repositories/users.ts';

const AUTHORIZE = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';

export interface AuthorizeOptions {
  clientId: string;
  redirectUri: string;
  state: string;
  challenge: string;
}

export function authorizeUrl(options: AuthorizeOptions): string {
  const url = new URL(AUTHORIZE);
  url.searchParams.set('client_id', options.clientId);
  url.searchParams.set('redirect_uri', options.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email');
  url.searchParams.set('state', options.state);
  url.searchParams.set('code_challenge', options.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

export interface ExchangeOptions {
  code: string;
  verifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetch: typeof globalThis.fetch;
}

interface TokenResponse {
  id_token?: string;
}

/**
 * Reads the claims out of an id_token WITHOUT verifying its signature.
 *
 * This is sanctioned rather than sloppy: OpenID Connect Core §3.1.3.7 permits
 * skipping verification when the token came directly from the token endpoint
 * over TLS, authenticated with the client secret — which is exactly this call.
 * The alternative is a JWKS dependency and key rotation handling for a
 * guarantee TLS already provides. **If this ever moves to a token received any
 * other way, signature verification becomes mandatory.**
 */
function claimsOf(idToken: string): Claims {
  const payload = idToken.split('.')[1];
  if (payload === undefined) throw new Error('malformed id_token');

  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    sub?: string;
    email?: string;
  };
  if (decoded.sub === undefined) throw new Error('id_token has no sub');

  return { provider: 'google', subject: decoded.sub, email: decoded.email ?? null };
}

export async function exchangeCode(options: ExchangeOptions): Promise<Claims> {
  const response = await options.fetch(TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: options.code,
      code_verifier: options.verifier,
      client_id: options.clientId,
      client_secret: options.clientSecret,
      redirect_uri: options.redirectUri,
    }),
  });

  if (!response.ok) throw new Error(`token endpoint returned ${response.status}`);

  const body = (await response.json()) as TokenResponse;
  if (body.id_token === undefined) throw new Error('token response has no id_token');

  return claimsOf(body.id_token);
}

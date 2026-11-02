/**
 * Cloudflare Access (ADR-8). The spec says to trust its header, but anything that can reach
 * the origin could set a header, so the JWT is verified against the team's public keys.
 */
import { verifyWithJwks } from 'hono/utils/jwt/jwt';

export interface AccessConfig {
  /** For example `yourteam.cloudflareaccess.com`. */
  teamDomain: string;
  /** The application's AUD tag from the Access dashboard. */
  audience: string;
}

type Key = NonNullable<Parameters<typeof verifyWithJwks>[1]['keys']>[number];

const KEY_CACHE_MS = 60 * 60 * 1000;

type FetchKeys = (url: string) => Promise<{ keys: Key[] }>;

const defaultFetchKeys: FetchKeys = async (url) => (await fetch(url)).json() as never;

export function createAccessVerifier(config: AccessConfig, fetchKeys = defaultFetchKeys) {
  const issuer = `https://${config.teamDomain}`;
  let cached: { keys: Key[]; at: number } | null = null;

  const keys = async (): Promise<Key[]> => {
    if (cached && Date.now() - cached.at < KEY_CACHE_MS) return cached.keys;
    const fetched = await fetchKeys(`${issuer}/cdn-cgi/access/certs`);
    cached = { keys: fetched.keys, at: Date.now() };
    return fetched.keys;
  };

  /** Never throws: a token that cannot be checked is simply not valid. */
  return async (token: string): Promise<boolean> => {
    try {
      await verifyWithJwks(token, {
        keys: await keys(),
        allowedAlgorithms: ['RS256'],
        verification: { iss: issuer, aud: config.audience },
      });
      return true;
    } catch {
      return false;
    }
  };
}

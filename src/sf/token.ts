import type Redis from 'ioredis';
import { postError } from '../notifications/slack.js';

const TOKEN_KEY = 'sf:token';
const TOKEN_TTL = 90 * 60; // 90 minutes

let tokenFetchPromise: Promise<string> | null = null;

export async function getToken(redis: Redis): Promise<string> {
  const cached = await redis.get(TOKEN_KEY);
  if (cached) return cached;
  return fetchAndCacheToken(redis);
}

function fetchAndCacheToken(redis: Redis): Promise<string> {
  if (tokenFetchPromise) return tokenFetchPromise;

  tokenFetchPromise = (async () => {
    try {
      const params = new URLSearchParams({
        grant_type: 'password',
        client_id: process.env.SF_CLIENT_ID!,
        client_secret: process.env.SF_CLIENT_SECRET!,
        username: process.env.SF_USERNAME!,
        password: process.env.SF_PASSWORD!,
      });

      const res = await fetch(
        `${process.env.SF_BASE_URL}/services/oauth2/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params.toString(),
          signal: AbortSignal.timeout(30_000),
        },
      );

      if (!res.ok) {
        const body = await res.text();
        const errMsg = `SF token fetch failed: ${res.status} — ${body}`;
        await postError({
          header: '🔴 Salesforce token refresh failed',
          body:
            `*Error:* ${errMsg}\n` +
            `*Time:*  ${new Date().toISOString()}\n` +
            'This will affect all pending SF sync jobs until resolved.',
        });
        throw new Error(errMsg);
      }

      const data = (await res.json()) as { access_token: string };
      await redis.setex(TOKEN_KEY, TOKEN_TTL, data.access_token);
      return data.access_token;
    } finally {
      tokenFetchPromise = null;
    }
  })();

  return tokenFetchPromise;
}

export async function invalidateToken(redis: Redis): Promise<void> {
  await redis.del(TOKEN_KEY);
  tokenFetchPromise = null;
}

export async function refreshToken(redis: Redis): Promise<string> {
  await invalidateToken(redis);
  return fetchAndCacheToken(redis);
}

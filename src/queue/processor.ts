import type { Job } from 'bullmq';
import { UnrecoverableError } from 'bullmq';
import type { SfForwardJob } from './client.js';
import { redis, getAESTDate, STATS_TTL } from './client.js';
import { getToken, refreshToken } from '../sf/token.js';
import { postError } from '../notifications/slack.js';
import { logger } from '../logger.js';

interface SfCallResult {
  status: number;
  body: unknown;
  durationMs: number;
}

async function callSalesforce(
  token: string,
  method: string,
  path: string,
  body: Record<string, unknown>,
): Promise<SfCallResult> {
  const start = Date.now();
  const res = await fetch(`${process.env.SF_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });

  let resBody: unknown;
  const text = await res.text();
  try {
    resBody = JSON.parse(text);
  } catch {
    resBody = text;
  }

  return { status: res.status, body: resBody, durationMs: Date.now() - start };
}

export async function processSfForward(job: Job<SfForwardJob>): Promise<void> {
  const { route, sfMethod, sfPath, body, enqueuedAt } = job.data;

  // 1. Get token
  let token = await getToken(redis);

  // 2. Make SF call
  let result = await callSalesforce(token, sfMethod, sfPath, body);

  // 3. Handle 401 — refresh token once and retry within the same attempt
  if (result.status === 401) {
    token = await refreshToken(redis);
    result = await callSalesforce(token, sfMethod, sfPath, body);
  }

  const processedAt = new Date().toISOString();

  // 4. Handle 2xx — success
  if (result.status >= 200 && result.status < 300) {
    logger.info({
      event: 'sf_forward_success',
      route,
      sfPath,
      sfStatus: result.status,
      attempt: job.attemptsMade + 1,
      durationMs: result.durationMs,
      jobId: job.id,
      enqueuedAt,
      processedAt,
    });

    // Increment stats with TTL
    const date = getAESTDate();
    const pipeline = redis.pipeline();
    const successKey = `sf:stats:${date}:success`;
    const routeKey = `sf:stats:${date}:route:${route}`;
    pipeline.incr(successKey);
    pipeline.expire(successKey, STATS_TTL);
    pipeline.incr(routeKey);
    pipeline.expire(routeKey, STATS_TTL);
    if (job.attemptsMade > 0) {
      const retriedKey = `sf:stats:${date}:retried`;
      pipeline.incr(retriedKey);
      pipeline.expire(retriedKey, STATS_TTL);
    }
    await pipeline.exec();

    return;
  }

  // 5. Handle second 401 after token refresh — retryable auth failure
  if (result.status === 401) {
    logger.error({
      event: 'sf_forward_failed',
      route,
      sfPath,
      sfStatus: 401,
      attempt: job.attemptsMade + 1,
      durationMs: result.durationMs,
      jobId: job.id,
      enqueuedAt,
      error: 'Salesforce returned 401 after token refresh',
      payload: body,
    });

    throw new Error('Salesforce returned 401 after token refresh');
  }

  // 6. Handle 4xx (not 401) — bad data, no retry
  if (result.status >= 400 && result.status < 500) {
    // SF errors can be an array [{message, errorCode}] or an object {message, errorCode}
    let sfErrorDetail: string;
    if (Array.isArray(result.body) && result.body.length > 0) {
      const first = result.body[0] as Record<string, unknown>;
      sfErrorDetail = String(first.message || first.errorCode || JSON.stringify(result.body));
    } else if (result.body && typeof result.body === 'object') {
      const obj = result.body as Record<string, unknown>;
      sfErrorDetail = String(obj.message || obj.errorCode || JSON.stringify(result.body));
    } else {
      sfErrorDetail = JSON.stringify(result.body);
    }

    logger.error({
      event: 'sf_forward_failed',
      route,
      sfPath,
      sfStatus: result.status,
      sfBody: result.body,
      attempt: job.attemptsMade + 1,
      durationMs: result.durationMs,
      jobId: job.id,
      enqueuedAt,
      error: `Salesforce returned ${result.status}`,
      payload: body,
    });

    // Post 4xx alert to Slack immediately
    await postError({
      header: '⚠️ Salesforce rejected the payload (4xx)',
      body:
        `*Route:*     ${route}\n` +
        `*SF Status:* ${result.status}\n` +
        `*SF Error:*  ${sfErrorDetail}\n` +
        `*Job ID:*    ${job.id}\n\n` +
        `Payload:\n\`\`\`${JSON.stringify(body, null, 2)}\`\`\``,
    });

    // Increment failed stat with TTL
    const date = getAESTDate();
    const failedKey = `sf:stats:${date}:failed`;
    await redis.incr(failedKey);
    await redis.expire(failedKey, STATS_TTL);

    throw new UnrecoverableError(`Salesforce returned ${result.status}`);
  }

  // 7. Handle 5xx / other — retryable error
  logger.error({
    event: 'sf_forward_failed',
    route,
    sfPath,
    sfStatus: result.status,
    sfBody: result.body,
    attempt: job.attemptsMade + 1,
    durationMs: result.durationMs,
    jobId: job.id,
    enqueuedAt,
    error: `Salesforce returned ${result.status}`,
    payload: body,
  });

  throw new Error(`Salesforce returned ${result.status}`);
}

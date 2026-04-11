import type { Job } from 'bullmq';
import { redis, getAESTYesterday, ALL_ROUTES } from './client.js';
import { postActivity } from '../notifications/slack.js';

export async function processDigest(_job: Job): Promise<void> {
  // Read yesterday's stats — the digest runs at 5 PM AEST, reporting on the previous full day
  const date = getAESTYesterday();

  // Read aggregate counters (direct GET — no KEYS/SCAN)
  const [successRaw, failedRaw, retriedRaw] = await redis.mget(
    `sf:stats:${date}:success`,
    `sf:stats:${date}:failed`,
    `sf:stats:${date}:retried`,
  );
  const successCount = parseInt(successRaw || '0', 10);
  const failedCount = parseInt(failedRaw || '0', 10);
  const retriedCount = parseInt(retriedRaw || '0', 10);

  // Read per-route counts using known route list (no KEYS/SCAN)
  const routeKeys = ALL_ROUTES.map((r) => `sf:stats:${date}:route:${r}`);
  const routeValues = await redis.mget(...routeKeys);
  const routeCounts: Record<string, number> = {};
  for (let i = 0; i < ALL_ROUTES.length; i++) {
    routeCounts[ALL_ROUTES[i]] = parseInt(routeValues[i] || '0', 10);
  }

  // Aggregate into display categories
  const categories: Record<string, number> = {
    '/crm/prospect': 0,
    '/crm/booking': 0,
    '/crm/consultation/:id': 0,
    '/crm/opportunity/*': 0,
    'other': 0,
  };

  for (const [route, count] of Object.entries(routeCounts)) {
    if (route.includes('/crm/prospect')) {
      categories['/crm/prospect'] += count;
    } else if (route.includes('/crm/booking')) {
      categories['/crm/booking'] += count;
    } else if (route.includes('/crm/consultation')) {
      categories['/crm/consultation/:id'] += count;
    } else if (route.includes('/crm/opportunity')) {
      categories['/crm/opportunity/*'] += count;
    } else {
      categories['other'] += count;
    }
  }

  const breakdownLines = Object.entries(categories)
    .map(([route, count]) => `  ${route.padEnd(25)} ${count}`)
    .join('\n');

  let message =
    `*Period:* ${date} AEST\n\n` +
    `✅ Successful jobs:  ${successCount}\n` +
    `❌ Failed jobs:      ${failedCount}\n` +
    `⚠️  Retried jobs:    ${retriedCount}\n\n` +
    `Breakdown by route:\n${breakdownLines}`;

  if (failedCount > 0) {
    message += `\n\n⚠️ ${failedCount} job(s) failed on ${date}. Check #sf-sync-errors for details.`;
  }

  await postActivity({
    header: '📊 SF Sync — Daily Summary',
    body: message,
  });

  // Store snapshot for reference (not used for deltas — keys auto-expire via TTL)
  await redis.set(
    'sf:digest:snapshot',
    JSON.stringify({ date, successCount, failedCount, retriedCount, routeCounts }),
  );
}

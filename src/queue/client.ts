import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { logger } from '../logger.js';

export interface SfForwardJob {
  route: string;          // e.g. "POST /crm/prospect"
  sfMethod: 'POST' | 'PATCH';
  sfPath: string;         // full SF path, e.g. "/services/apexrest/Prospect/"
  body: Record<string, unknown>;
  enqueuedAt: string;     // ISO timestamp
}

if (!process.env.REDIS_URL) {
  throw new Error('REDIS_URL environment variable is required');
}

export const redis = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

export const sfForwardQueue = new Queue<SfForwardJob>('sf-forward', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7 }, // 7 days
    removeOnFail: false,
  },
});

export const sfDigestQueue = new Queue('sf-digest', {
  connection: redis,
});

/** TTL for stat keys — 48 hours in seconds. Keys auto-expire instead of explicit deletion. */
export const STATS_TTL = 172800;

/** All known route labels. Used by digest to enumerate stats without SCAN/KEYS. */
export const ALL_ROUTES = [
  'POST /crm/prospect',
  'POST /crm/booking',
  'PATCH /crm/lead/:id',
  'PATCH /crm/account/:id',
  'PATCH /crm/contact/:id',
  'PATCH /crm/opportunity/case/:id',
  'PATCH /crm/opportunity/project/:id',
  'PATCH /crm/project-expert/:id',
  'PATCH /crm/consultation/:id',
];

/** Returns the given Date's date in AEST/AEDT (Australia/Sydney) as YYYY-MM-DD, DST-aware. */
function formatAESTDate(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Australia/Sydney',
  }).format(date);
}

/** Today's date in AEST. Used for stat key bucketing. */
export function getAESTDate(): string {
  return formatAESTDate(new Date());
}

/** Yesterday's calendar date in AEST. DST-safe (subtracts one calendar day, not 24 hours). */
export function getAESTYesterday(): string {
  const today = formatAESTDate(new Date()); // e.g. "2026-04-11"
  const [y, m, d] = today.split('-').map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1));
  return yesterday.toISOString().slice(0, 10);
}

import { Worker } from 'bullmq';
import type { Job } from 'bullmq';
import type { SfForwardJob } from './client.js';
import { redis, getAESTDate, STATS_TTL } from './client.js';
import { processSfForward } from './processor.js';
import { processDigest } from './digest.js';
import { postActivity, postError } from '../notifications/slack.js';
import { logger } from '../logger.js';

// --- Slack activity level ---
// SLACK_ACTIVITY_LEVEL controls how much detail success messages include:
//   "full"    — route, SF path, job ID, and full payload (for dev/debugging)
//   "compact" — human-readable summary per route (for production)
type ActivityLevel = 'full' | 'compact';

function getActivityLevel(): ActivityLevel {
  const level = process.env.SLACK_ACTIVITY_LEVEL?.toLowerCase();
  if (level === 'full') return 'full';
  return 'compact';
}

// --- Compact activity message builders ---
// NOTE: Field names (firstName, lastName, companyName, opportunityName, etc.)
// must match the JSON keys Bubble sends. If Bubble changes its payload shape,
// these messages will silently degrade to showing '—'.

function buildCompactMessage(job: Job<SfForwardJob>): { header: string; body: string } | null {
  const { route, body } = job.data;
  const b = body as Record<string, unknown>;

  if (route === 'POST /crm/prospect') {
    return {
      header: '🟢 New prospect signed up',
      body:
        `*Name:*    ${[b.firstName, b.lastName].filter(Boolean).join(' ') || '—'}\n` +
        `*Company:* ${b.companyName || '—'}\n` +
        `*Role:*    ${b.baloRole || '—'}\n` +
        `*Country:* ${b.country || '—'}`,
    };
  }

  if (route === 'POST /crm/booking/:id') {
    return {
      header: '🟢 Booking converted',
      body:
        `*Opportunity:* ${b.opportunityName || '—'}\n` +
        `*Type:*        ${b.opportunityType || '—'}\n` +
        `*Customer ID:* ${b.customerBaloId || '—'}`,
    };
  }

  if (route === 'PATCH /crm/opportunity/case/:id') {
    return {
      header: '🔵 Case opportunity updated',
      body:
        `*Name:*   ${b.Name || '—'}\n` +
        `*Stage:*  ${b.StageName || '—'}\n` +
        `*Amount:* ${b.Amount || '—'}`,
    };
  }

  if (route === 'PATCH /crm/opportunity/project/:id') {
    return {
      header: '🔵 Project opportunity updated',
      body:
        `*Name:*       ${b.Name || '—'}\n` +
        `*Stage:*      ${b.StageName || '—'}\n` +
        `*Sub-status:* ${b.Sub_status__c || '—'}`,
    };
  }

  if (route === 'PATCH /crm/consultation/:id') {
    return {
      header: '🔵 Consultation synced',
      body:
        `*Status:*   ${b.Status__c || '—'}\n` +
        `*Duration:* ${b.Actual_Duration_Minutes__c || b.Duration_Minutes__c || '—'} mins\n` +
        `*Billing:*  ${b.Billing_Mode__c || '—'}`,
    };
  }

  // Silent routes in compact mode
  return null;
}

function buildFullMessage(job: Job<SfForwardJob>): { header: string; body: string } {
  const { route, sfPath, body } = job.data;
  return {
    header: '🟢 SF sync succeeded',
    body:
      `*Route:*   ${route}\n` +
      `*SF Path:* ${process.env.SF_BASE_URL}${sfPath}\n` +
      `*Job ID:*  ${job.id}\n\n` +
      `Payload:\n\`\`\`${JSON.stringify(body, null, 2)}\`\`\``,
  };
}

function buildActivityMessage(job: Job<SfForwardJob>): { header: string; body: string } | null {
  if (getActivityLevel() === 'full') {
    return buildFullMessage(job);
  }
  return buildCompactMessage(job);
}

// --- Workers ---

export function startWorkers(): { forwardWorker: Worker<SfForwardJob>; digestWorker: Worker } {
  const forwardWorker = new Worker<SfForwardJob>('sf-forward', processSfForward, {
    connection: redis,
    concurrency: 1,
  });

  // On job completed — post activity to Slack
  forwardWorker.on('completed', async (job: Job<SfForwardJob> | undefined) => {
    try {
      if (!job) return;
      const msg = buildActivityMessage(job);
      if (msg) {
        await postActivity(msg);
      }
    } catch (err) {
      logger.error({ err, jobId: job?.id }, 'Error in completed event handler');
    }
  });

  // On job failed — dead letter alert when all retries exhausted
  forwardWorker.on('failed', async (job: Job<SfForwardJob> | undefined, err: Error) => {
    try {
      if (!job) return;
      const maxAttempts = job.opts?.attempts ?? 3;
      if (job.attemptsMade >= maxAttempts) {
        const { route, sfPath, body, enqueuedAt } = job.data;

        // Extract SF status from error message if available
        const sfStatusMatch = err.message.match(/Salesforce returned (\d+)/);
        const sfStatus = sfStatusMatch ? sfStatusMatch[1] : 'no response';

        // Increment failed stat with TTL
        const date = getAESTDate();
        const failedKey = `sf:stats:${date}:failed`;
        await redis.incr(failedKey);
        await redis.expire(failedKey, STATS_TTL);

        await postError({
          header: '🔴 SF sync job failed permanently',
          body:
            `*Route:*     ${route}\n` +
            `*SF Path:*   ${process.env.SF_BASE_URL}${sfPath}\n` +
            `*Job ID:*    ${job.id}\n` +
            `*Attempts:*  ${job.attemptsMade}\n` +
            `*Error:*     ${err.message}\n` +
            `*SF Status:* ${sfStatus}\n` +
            `*Enqueued:*  ${enqueuedAt}\n\n` +
            `Payload:\n\`\`\`${JSON.stringify(body, null, 2)}\`\`\``,
        });
      }
    } catch (handlerErr) {
      logger.error({ err: handlerErr, jobId: job?.id }, 'Error in failed event handler');
    }
  });

  forwardWorker.on('error', (err) => {
    logger.error({ err }, 'Forward worker error');
  });

  const digestWorker = new Worker('sf-digest', processDigest, {
    connection: redis,
  });

  digestWorker.on('error', (err) => {
    logger.error({ err }, 'Digest worker error');
  });

  return { forwardWorker, digestWorker };
}

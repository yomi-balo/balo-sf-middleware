import { logger } from '../logger.js';

interface SlackMessage {
  header: string;
  body: string;
}

const MAX_SECTION_LENGTH = 2500;

async function postWebhook(url: string | undefined, msg: SlackMessage): Promise<void> {
  if (!url) return;
  try {
    const body = msg.body.length > MAX_SECTION_LENGTH
      ? msg.body.substring(0, MAX_SECTION_LENGTH) + '\n…(truncated)'
      : msg.body;

    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        blocks: [
          {
            type: 'header',
            text: { type: 'plain_text', text: msg.header, emoji: true },
          },
          {
            type: 'section',
            text: { type: 'mrkdwn', text: body },
          },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logger.error({ err }, 'Slack webhook failed');
  }
}

export async function postActivity(msg: SlackMessage): Promise<void> {
  await postWebhook(process.env.SLACK_WEBHOOK_ACTIVITY, msg);
}

export async function postError(msg: SlackMessage): Promise<void> {
  await postWebhook(process.env.SLACK_WEBHOOK_ERRORS, msg);
}

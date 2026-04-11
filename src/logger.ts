import pino from 'pino';
import type { FastifyServerOptions } from 'fastify';

function getTransportTargets(): Array<{ target: string; options: Record<string, unknown> }> {
  const targets: Array<{ target: string; options: Record<string, unknown> }> = [
    { target: 'pino/file', options: { destination: 1 } },
  ];

  if (process.env.AXIOM_TOKEN) {
    targets.push({
      target: 'pino-axiom',
      options: {
        orgId: process.env.AXIOM_ORG_ID || '',
        dataset: process.env.AXIOM_DATASET || 'sf-middleware',
        token: process.env.AXIOM_TOKEN,
      },
    });
  }

  return targets;
}

/** Logger config passed to Fastify constructor for request/response logging. */
export function buildLoggerConfig(): FastifyServerOptions['logger'] {
  return {
    level: process.env.LOG_LEVEL || 'info',
    transport: { targets: getTransportTargets() },
  };
}

/** Standalone Pino instance for use outside Fastify (workers, processors). */
export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets: getTransportTargets() },
});

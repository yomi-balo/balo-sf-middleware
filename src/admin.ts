import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import basicAuth from '@fastify/basic-auth';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { FastifyAdapter } from '@bull-board/fastify';
import { sfForwardQueue, sfDigestQueue } from './queue/client.js';

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export default async function adminPlugin(fastify: FastifyInstance): Promise<void> {
  // Basic auth — scoped to this encapsulated context only
  await fastify.register(basicAuth, {
    validate: async (username, password, _req, _reply) => {
      const validUser = safeEqual(username, process.env.BULL_BOARD_USERNAME!);
      const validPass = safeEqual(password, process.env.BULL_BOARD_PASSWORD!);
      if (!validUser || !validPass) {
        throw new Error('Unauthorized');
      }
    },
    authenticate: { realm: 'sf-middleware' },
  });

  fastify.addHook('onRequest', fastify.basicAuth);

  // Bull Board UI
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath('/admin/queues');

  createBullBoard({
    queues: [
      new BullMQAdapter(sfForwardQueue),
      new BullMQAdapter(sfDigestQueue),
    ],
    serverAdapter,
  });

  await fastify.register(serverAdapter.registerPlugin(), { prefix: '/' });
}

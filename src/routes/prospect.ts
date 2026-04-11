import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sfForwardQueue } from '../queue/client.js';

export default async function prospectRoute(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/crm/prospect',
    async (request: FastifyRequest<{ Body: Record<string, unknown> }>, reply) => {
      const job = await sfForwardQueue.add('sf-forward', {
        route: 'POST /crm/prospect',
        sfMethod: 'POST',
        sfPath: '/services/apexrest/Prospect/',
        body: request.body,
        enqueuedAt: new Date().toISOString(),
      });

      reply.code(202).send({ accepted: true, jobId: job.id });
    },
  );
}

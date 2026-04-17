import type { FastifyInstance, FastifyRequest } from 'fastify';
import { sfForwardQueue } from '../queue/client.js';

const SF_VERSION = process.env.SF_API_VERSION || 'v65.0';

export default async function bookingRoute(fastify: FastifyInstance): Promise<void> {
  fastify.post(
    '/crm/booking/:id',
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>,
      reply,
    ) => {
      const id = encodeURIComponent(request.params.id);
      const sfPath = `/services/data/${SF_VERSION}/sobjects/Opportunity/Balo_Id__c/${id}`;

      const job = await sfForwardQueue.add('sf-forward', {
        route: 'POST /crm/booking/:id',
        sfMethod: 'PATCH',
        sfPath,
        body: request.body,
        enqueuedAt: new Date().toISOString(),
      });

      reply.code(202).send({ accepted: true, jobId: job.id });
    },
  );
}

import type { FastifyInstance } from 'fastify';

export default async function healthRoute(fastify: FastifyInstance): Promise<void> {
  fastify.get('/health', async (_request, _reply) => {
    return { status: 'ok' };
  });
}

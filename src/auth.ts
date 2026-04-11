import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export async function bearerAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization;
  const expected = `Bearer ${process.env.MIDDLEWARE_API_SECRET}`;

  if (
    !header ||
    header.length !== expected.length ||
    !timingSafeEqual(Buffer.from(header), Buffer.from(expected))
  ) {
    return reply.code(401).send({ error: 'Unauthorized' });
  }
}

import 'dotenv/config';
import Fastify from 'fastify';
import { buildLoggerConfig } from './logger.js';
import { bearerAuth } from './auth.js';
import healthRoute from './routes/health.js';
import prospectRoute from './routes/prospect.js';
import bookingRoute from './routes/booking.js';
import upsertRoutes from './routes/upsert.js';
import adminPlugin from './admin.js';
import { sfDigestQueue, redis } from './queue/client.js';
import { startWorkers } from './queue/worker.js';

const REQUIRED_ENV = [
  'MIDDLEWARE_API_SECRET',
  'SF_BASE_URL',
  'SF_CLIENT_ID',
  'SF_CLIENT_SECRET',
  'BULL_BOARD_USERNAME',
  'BULL_BOARD_PASSWORD',
] as const;

async function main(): Promise<void> {
  // Fail fast if any required env vars are missing
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const app = Fastify({ logger: buildLoggerConfig(), ignoreTrailingSlash: true });

  // --- Health check (unauthenticated) ---
  await app.register(healthRoute);

  // --- Bull Board admin UI (basic auth, scoped inside the plugin) ---
  await app.register(adminPlugin, { prefix: '/admin/queues' });

  // --- CRM routes (bearer auth) ---
  await app.register(async function crmRoutes(crm) {
    crm.addHook('onRequest', bearerAuth);
    await crm.register(prospectRoute);
    await crm.register(bookingRoute);
    await crm.register(upsertRoutes);
  });

  // --- Start BullMQ workers ---
  const { forwardWorker, digestWorker } = startWorkers();

  // --- Register repeatable digest job ---
  const digestCron = process.env.DIGEST_CRON || '0 7 * * *';
  await sfDigestQueue.upsertJobScheduler(
    'daily-digest',
    { pattern: digestCron },
    { name: 'daily-digest' },
  );

  // --- Graceful shutdown with timeout ---
  const SHUTDOWN_TIMEOUT_MS = 8_000; // Must be under Railway's 10s SIGTERM grace period

  const shutdown = async (): Promise<void> => {
    app.log.info('Shutting down…');
    try {
      await Promise.race([
        (async () => {
          await forwardWorker.close();
          await digestWorker.close();
          await app.close();
          await redis.quit();
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Shutdown timed out')), SHUTDOWN_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      app.log.error(err, 'Error during shutdown');
    }
    process.exit(0);
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  // --- Start server ---
  const port = parseInt(process.env.PORT || '3000', 10);
  await app.listen({ port, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

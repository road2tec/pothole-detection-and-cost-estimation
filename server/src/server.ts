import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { connectDb, disconnectDb } from './config/db.js';
import { ensureStorage } from './services/storage.js';
import { getActiveCostConfig } from './services/settings.js';
import { startWorker, stopWorker } from './jobs/worker.js';
import { User } from './models/User.js';

async function main() {
  await ensureStorage();
  await connectDb();
  await getActiveCostConfig(); // creates the prototype defaults on first start
  if (!(await User.exists({ role: 'admin', status: 'active' }))) {
    logger.warn('No active administrator exists. Create one with: npm --prefix server run bootstrap:admin');
  }
  const app = createApp();
  const server = app.listen(env.PORT, () => logger.info(`API listening on http://localhost:${env.PORT}`));
  if (env.WORKER_ENABLED) startWorker();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutting down');
    stopWorker();
    server.close();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

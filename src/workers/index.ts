import { Worker } from 'bullmq';
import { startAllWorkers } from './agent.worker.js';
import { queueService } from '../core/queue/queue.service.js';
import { minioService } from '../core/storage/minio.service.js';
import { connectDatabase, disconnectDatabase } from '../db/client.js';
import { logger } from '../shared/utils/logger.js';

let workers: Worker[] = [];

async function main() {
  logger.info('Starting RFQ Automation Workers...');

  // Initialize database connection
  await connectDatabase();

  // Initialize MinIO
  await minioService.initialize();

  // Initialize queue service
  await queueService.initialize();

  // Start all agent workers
  workers = startAllWorkers();

  logger.info({ workerCount: workers.length }, 'All workers started');

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    // Close all workers
    await Promise.all(workers.map((w) => w.close()));
    logger.info('Workers closed');

    // Close queue service
    await queueService.close();
    logger.info('Queue service closed');

    // Disconnect database
    await disconnectDatabase();

    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  logger.error({ error }, 'Failed to start workers');
  process.exit(1);
});

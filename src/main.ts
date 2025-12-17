import { startServer } from './api/server.js';
import { queueService } from './core/queue/queue.service.js';
import { minioService } from './core/storage/minio.service.js';
import { connectDatabase, disconnectDatabase } from './db/client.js';
import { logger } from './shared/utils/logger.js';

async function main() {
  logger.info('Starting RFQ Automation API Server...');

  // Initialize database connection
  await connectDatabase();

  // Initialize MinIO
  await minioService.initialize();

  // Initialize queue service
  await queueService.initialize();

  // Start the API server
  const server = await startServer();

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');

    // Close the server
    await server.close();
    logger.info('Server closed');

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
  logger.error({ error }, 'Failed to start server');
  process.exit(1);
});

import Fastify from 'fastify';
import multipart from '@fastify/multipart';
import { config } from '../config/index.js';
import { logger } from '../shared/utils/logger.js';
import { errorHandler } from './middleware/error-handler.js';
import { emailRoutes, executionRoutes, healthRoutes } from './routes/index.js';
import { registerSwagger } from './swagger.config.js';

export async function createServer() {
  const fastify = Fastify({
    logger: {
      level: config.logLevel,
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'SYS:standard',
              },
            }
          : undefined,
    },
  });

  // Register Swagger documentation
  await registerSwagger(fastify);

  // Register multipart for file uploads
  await fastify.register(multipart, {
    limits: {
      fileSize: 50 * 1024 * 1024, // 50MB max file size
      files: 10, // Max 10 files per request
    },
  });

  // Register error handler
  fastify.setErrorHandler(errorHandler);

  // Register routes
  await fastify.register(healthRoutes);
  await fastify.register(emailRoutes, { prefix: '/api/v1' });
  await fastify.register(executionRoutes, { prefix: '/api/v1' });

  // Add request logging hook
  fastify.addHook('onRequest', async (request) => {
    logger.debug(
      { method: request.method, url: request.url },
      'Incoming request'
    );
  });

  // Add response logging hook
  fastify.addHook('onResponse', async (request, reply) => {
    logger.debug(
      {
        method: request.method,
        url: request.url,
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed'
    );
  });

  return fastify;
}

export async function startServer() {
  const server = await createServer();

  try {
    await server.listen({ port: config.port, host: '0.0.0.0' });
    logger.info({ port: config.port }, 'Server started');
    return server;
  } catch (error) {
    logger.error({ error }, 'Failed to start server');
    throw error;
  }
}

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../db/client.js';
import { queueService } from '../../core/queue/queue.service.js';
import { minioService } from '../../core/storage/minio.service.js';

export async function healthRoutes(fastify: FastifyInstance) {
  // Basic health check
  fastify.get(
    '/health',
    {
      schema: {
        tags: ['Health'],
        summary: 'Basic health check',
        description: 'Returns basic service status',
        response: {
          200: {
            description: 'Service is healthy',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
              timestamp: { type: 'string', format: 'date-time' },
              service: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        status: 'ok',
        timestamp: new Date().toISOString(),
        service: 'rfq-automation',
      });
    }
  );

  // Detailed readiness check
  fastify.get(
    '/health/ready',
    {
      schema: {
        tags: ['Health'],
        summary: 'Detailed readiness check',
        description: 'Checks database, Redis, and MinIO connectivity',
        response: {
          200: {
            description: 'All services are healthy',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ready', 'not_ready'] },
              timestamp: { type: 'string', format: 'date-time' },
              checks: {
                type: 'object',
                properties: {
                  database: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                      latencyMs: { type: 'integer' },
                      error: { type: 'string' },
                    },
                  },
                  redis: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                      latencyMs: { type: 'integer' },
                      error: { type: 'string' },
                    },
                  },
                  minio: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', enum: ['healthy', 'unhealthy'] },
                      latencyMs: { type: 'integer' },
                      error: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
          503: {
            description: 'One or more services are unhealthy',
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['not_ready'] },
              timestamp: { type: 'string', format: 'date-time' },
              checks: { type: 'object' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const checks: Record<string, { status: string; latencyMs?: number; error?: string }> = {};

      // Check database
      const dbStart = Date.now();
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = {
          status: 'healthy',
          latencyMs: Date.now() - dbStart,
        };
      } catch (error) {
        checks.database = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      // Check Redis/Queue
      const redisStart = Date.now();
      try {
        const isHealthy = await queueService.healthCheck();
        checks.redis = {
          status: isHealthy ? 'healthy' : 'unhealthy',
          latencyMs: Date.now() - redisStart,
        };
      } catch (error) {
        checks.redis = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      // Check MinIO
      const minioStart = Date.now();
      try {
        const isHealthy = await minioService.healthCheck();
        checks.minio = {
          status: isHealthy ? 'healthy' : 'unhealthy',
          latencyMs: Date.now() - minioStart,
        };
      } catch (error) {
        checks.minio = {
          status: 'unhealthy',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      const allHealthy = Object.values(checks).every((c) => c.status === 'healthy');

      return reply.status(allHealthy ? 200 : 503).send({
        status: allHealthy ? 'ready' : 'not_ready',
        timestamp: new Date().toISOString(),
        checks,
      });
    }
  );

  // Get queue stats
  fastify.get(
    '/health/queues',
    {
      schema: {
        tags: ['Health'],
        summary: 'Get queue statistics',
        description: 'Returns job counts for all agent queues',
        response: {
          200: {
            description: 'Queue statistics',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              queues: {
                type: 'object',
                additionalProperties: {
                  type: 'object',
                  properties: {
                    waiting: { type: 'integer' },
                    active: { type: 'integer' },
                    completed: { type: 'integer' },
                    failed: { type: 'integer' },
                    delayed: { type: 'integer' },
                  },
                },
              },
            },
          },
          500: {
            description: 'Failed to get queue stats',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const counts = await queueService.getJobCounts();
        return reply.send({
          success: true,
          queues: counts,
        });
      } catch (error) {
        return reply.status(500).send({
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }
  );
}

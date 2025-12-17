import { FastifyInstance } from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

export async function registerSwagger(fastify: FastifyInstance) {
  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'RFQ Automation API',
        description: `
## Overview

RFQ Automation API for processing Request for Quote (RFQ) emails through a pipeline of 6 specialized AI agents.

### Agent Pipeline

1. **Intake** - Parse incoming RFQ emails and extract structured data
2. **Missing Info** - Identify missing information and generate clarification requests
3. **Duplicate** - Detect duplicate or similar RFQ requests
4. **Prioritization** - Classify complexity and assign priority
5. **MTO** - Generate Material Take-Off drafts
6. **Auto-Quote** - Generate quotes for low/medium complexity requests

### Key Features

- **Event Sourcing**: Full audit trail with immutable events
- **Human-in-the-Loop**: Agents can pause for human intervention
- **Checkpoint Resume**: Resume from any point in the pipeline
- **Replay Capability**: Re-execute from any agent
        `,
        version: '1.0.0',
        contact: {
          name: 'RFQ Automation Team',
        },
        license: {
          name: 'MIT',
        },
      },
      servers: [
        {
          url: 'http://localhost:3000',
          description: 'Development server',
        },
      ],
      tags: [
        {
          name: 'Health',
          description: 'Health check endpoints',
        },
        {
          name: 'Emails',
          description: 'Email upload and management',
        },
        {
          name: 'Executions',
          description: 'RFQ processing execution management',
        },
        {
          name: 'Agents',
          description: 'Agent pipeline information',
        },
      ],
      components: {
        schemas: {
          // Common schemas
          SuccessResponse: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
            },
          },
          ErrorResponse: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              error: { type: 'string' },
              code: { type: 'string' },
            },
          },
          PaginationMeta: {
            type: 'object',
            properties: {
              total: { type: 'integer' },
              limit: { type: 'integer' },
              offset: { type: 'integer' },
            },
          },

          // Email schemas
          Email: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              subject: { type: 'string', nullable: true },
              body: { type: 'string' },
              senderEmail: { type: 'string', format: 'email' },
              receivedAt: { type: 'string', format: 'date-time' },
              metadata: { type: 'object' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              attachments: {
                type: 'array',
                items: { $ref: '#/components/schemas/EmailAttachment' },
              },
            },
          },
          EmailAttachment: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              filename: { type: 'string' },
              originalName: { type: 'string' },
              mimeType: { type: 'string' },
              size: { type: 'integer', description: 'Size in bytes' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },
          CreateEmailRequest: {
            type: 'object',
            required: ['body', 'senderEmail'],
            properties: {
              subject: { type: 'string' },
              body: { type: 'string' },
              senderEmail: { type: 'string', format: 'email' },
              receivedAt: { type: 'string', format: 'date-time' },
              metadata: { type: 'object' },
            },
          },

          // Execution schemas
          Execution: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              emailId: { type: 'string', format: 'uuid' },
              externalRef: { type: 'string', nullable: true },
              status: { $ref: '#/components/schemas/ExecutionStatus' },
              currentAgent: { type: 'string', nullable: true },
              metadata: { type: 'object' },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
            },
          },
          ExecutionStatus: {
            type: 'string',
            enum: ['PENDING', 'PROCESSING', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED'],
          },
          CreateExecutionRequest: {
            type: 'object',
            required: ['emailId'],
            properties: {
              emailId: { type: 'string', format: 'uuid' },
              externalRef: { type: 'string' },
              metadata: { type: 'object' },
            },
          },
          ResumeExecutionRequest: {
            type: 'object',
            properties: {
              updatedState: {
                type: 'object',
                description: 'Updated RFQ state from human intervention',
              },
              resumeFromAgent: { $ref: '#/components/schemas/AgentName' },
            },
          },
          ReplayExecutionRequest: {
            type: 'object',
            required: ['fromAgent'],
            properties: {
              fromAgent: { $ref: '#/components/schemas/AgentName' },
            },
          },

          // Agent schemas
          AgentName: {
            type: 'string',
            enum: ['intake', 'missing-info', 'duplicate', 'prioritization', 'mto', 'auto-quote'],
          },
          Agent: {
            type: 'object',
            properties: {
              name: { $ref: '#/components/schemas/AgentName' },
              order: { type: 'integer' },
              description: { type: 'string' },
            },
          },
          AgentTask: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              executionId: { type: 'string', format: 'uuid' },
              agentName: { type: 'string' },
              attemptNumber: { type: 'integer' },
              status: {
                type: 'string',
                enum: ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'AWAITING_HUMAN', 'SKIPPED'],
              },
              durationMs: { type: 'integer', nullable: true },
              tokenUsage: { type: 'object', nullable: true },
              costUsd: { type: 'number', nullable: true },
              errorMessage: { type: 'string', nullable: true },
              startedAt: { type: 'string', format: 'date-time', nullable: true },
              completedAt: { type: 'string', format: 'date-time', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },

          // Event schemas
          Event: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              executionId: { type: 'string', format: 'uuid' },
              agentTaskId: { type: 'string', format: 'uuid', nullable: true },
              eventType: { type: 'string' },
              eventData: { type: 'object' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },

          // Snapshot schemas
          RfqSnapshot: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              executionId: { type: 'string', format: 'uuid' },
              agentName: { type: 'string' },
              snapshotType: {
                type: 'string',
                enum: ['INPUT', 'OUTPUT', 'HUMAN_UPDATE'],
              },
              data: { type: 'object' },
              createdAt: { type: 'string', format: 'date-time' },
            },
          },

          // Health schemas
          HealthCheck: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok'] },
              timestamp: { type: 'string', format: 'date-time' },
              service: { type: 'string' },
            },
          },
          ReadinessCheck: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ready', 'not_ready'] },
              timestamp: { type: 'string', format: 'date-time' },
              checks: {
                type: 'object',
                properties: {
                  database: { $ref: '#/components/schemas/ServiceCheck' },
                  redis: { $ref: '#/components/schemas/ServiceCheck' },
                  minio: { $ref: '#/components/schemas/ServiceCheck' },
                },
              },
            },
          },
          ServiceCheck: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['healthy', 'unhealthy'] },
              latencyMs: { type: 'integer' },
              error: { type: 'string' },
            },
          },
          QueueStats: {
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
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
      displayRequestDuration: true,
    },
    staticCSP: true,
  });
}

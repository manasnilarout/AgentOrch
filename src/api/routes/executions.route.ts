import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { executionService } from '../../core/execution/execution.service.js';
import { AGENT_PIPELINE, AgentName } from '../../shared/types/agent.types.js';

// Request schemas
const CreateExecutionSchema = z.object({
  emailId: z.string().uuid(),
  externalRef: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const ListExecutionsQuerySchema = z.object({
  status: z
    .enum(['PENDING', 'PROCESSING', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED'])
    .optional(),
  emailId: z.string().uuid().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  orderBy: z.enum(['createdAt', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const GetExecutionParamsSchema = z.object({
  executionId: z.string().uuid(),
});

const ResumeExecutionSchema = z.object({
  updatedState: z.record(z.unknown()).optional(),
  resumeFromAgent: z
    .enum(['intake', 'missing-info', 'duplicate', 'prioritization', 'mto', 'auto-quote'])
    .optional(),
});

const ReplayExecutionSchema = z.object({
  fromAgent: z.enum([
    'intake',
    'missing-info',
    'duplicate',
    'prioritization',
    'mto',
    'auto-quote',
  ]),
});

export async function executionRoutes(fastify: FastifyInstance) {
  // Create new execution for an email
  fastify.post(
    '/executions',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Create new execution',
        description: 'Start a new RFQ processing execution for an uploaded email',
        body: {
          type: 'object',
          required: ['emailId'],
          properties: {
            emailId: { type: 'string', format: 'uuid', description: 'Email ID to process' },
            externalRef: { type: 'string', description: 'External reference ID' },
            metadata: { type: 'object', description: 'Additional metadata' },
          },
        },
        response: {
          201: {
            description: 'Execution created',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              executionId: { type: 'string', format: 'uuid' },
            },
          },
          400: {
            description: 'Validation error',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          404: {
            description: 'Email not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Body: z.infer<typeof CreateExecutionSchema> }>,
      reply: FastifyReply
    ) => {
      const body = CreateExecutionSchema.parse(request.body);

      const executionId = await executionService.create(body);

      return reply.status(201).send({
        success: true,
        executionId,
      });
    }
  );

  // List executions
  fastify.get(
    '/executions',
    {
      schema: {
        tags: ['Executions'],
        summary: 'List executions',
        description: 'Get a paginated list of executions with optional filtering',
        querystring: {
          type: 'object',
          properties: {
            status: {
              type: 'string',
              enum: ['PENDING', 'PROCESSING', 'AWAITING_HUMAN', 'COMPLETED', 'FAILED', 'CANCELLED'],
              description: 'Filter by execution status',
            },
            emailId: { type: 'string', format: 'uuid', description: 'Filter by email ID' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
            offset: { type: 'integer', minimum: 0, default: 0 },
            orderBy: { type: 'string', enum: ['createdAt', 'updatedAt'], default: 'createdAt' },
            order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          },
        },
        response: {
          200: {
            description: 'List of executions',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              executions: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    emailId: { type: 'string', format: 'uuid' },
                    status: { type: 'string' },
                    currentAgent: { type: 'string', nullable: true },
                    createdAt: { type: 'string', format: 'date-time' },
                    updatedAt: { type: 'string', format: 'date-time' },
                    completedAt: { type: 'string', format: 'date-time', nullable: true },
                  },
                },
              },
              total: { type: 'integer' },
              limit: { type: 'integer' },
              offset: { type: 'integer' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof ListExecutionsQuerySchema> }>,
      reply: FastifyReply
    ) => {
      const query = ListExecutionsQuerySchema.parse(request.query);

      const result = await executionService.list({
        status: query.status as any,
        emailId: query.emailId,
        limit: query.limit,
        offset: query.offset,
        orderBy: query.orderBy,
        order: query.order,
      });

      return reply.send({
        success: true,
        ...result,
      });
    }
  );

  // Get execution by ID
  fastify.get(
    '/executions/:executionId',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Get execution by ID',
        description: 'Get execution details including current state and agent tasks',
        params: {
          type: 'object',
          required: ['executionId'],
          properties: {
            executionId: { type: 'string', format: 'uuid', description: 'Execution ID' },
          },
        },
        response: {
          200: {
            description: 'Execution details',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              execution: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  emailId: { type: 'string', format: 'uuid' },
                  externalRef: { type: 'string', nullable: true },
                  status: { type: 'string' },
                  currentAgent: { type: 'string', nullable: true },
                  metadata: { type: 'object' },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                  completedAt: { type: 'string', format: 'date-time', nullable: true },
                  agentTasks: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        agentName: { type: 'string' },
                        status: { type: 'string' },
                        attemptNumber: { type: 'integer' },
                        durationMs: { type: 'integer', nullable: true },
                        startedAt: { type: 'string', format: 'date-time', nullable: true },
                        completedAt: { type: 'string', format: 'date-time', nullable: true },
                      },
                    },
                  },
                  snapshots: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        agentName: { type: 'string' },
                        snapshotType: { type: 'string' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Execution not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: z.infer<typeof GetExecutionParamsSchema> }>,
      reply: FastifyReply
    ) => {
      const { executionId } = GetExecutionParamsSchema.parse(request.params);
      const execution = await executionService.getById(executionId);

      return reply.send({
        success: true,
        execution,
      });
    }
  );

  // Get execution history (full audit trail)
  fastify.get(
    '/executions/:executionId/history',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Get execution history',
        description: 'Get full audit trail including all events, tasks, and state snapshots',
        params: {
          type: 'object',
          required: ['executionId'],
          properties: {
            executionId: { type: 'string', format: 'uuid', description: 'Execution ID' },
          },
        },
        response: {
          200: {
            description: 'Execution history',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              execution: { type: 'object' },
              tasks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    agentName: { type: 'string' },
                    status: { type: 'string' },
                    attemptNumber: { type: 'integer' },
                    durationMs: { type: 'integer', nullable: true },
                    tokenUsage: { type: 'object', nullable: true },
                    costUsd: { type: 'number', nullable: true },
                    errorMessage: { type: 'string', nullable: true },
                    startedAt: { type: 'string', format: 'date-time', nullable: true },
                    completedAt: { type: 'string', format: 'date-time', nullable: true },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              events: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    eventType: { type: 'string' },
                    eventData: { type: 'object' },
                    agentTaskId: { type: 'string', format: 'uuid', nullable: true },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
              snapshots: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    agentName: { type: 'string' },
                    snapshotType: { type: 'string' },
                    data: { type: 'object' },
                    createdAt: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: z.infer<typeof GetExecutionParamsSchema> }>,
      reply: FastifyReply
    ) => {
      const { executionId } = GetExecutionParamsSchema.parse(request.params);
      const history = await executionService.getHistory(executionId);

      return reply.send({
        success: true,
        ...history,
      });
    }
  );

  // Resume execution after human intervention
  fastify.post(
    '/executions/:executionId/resume',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Resume execution',
        description: `
Resume an execution that is waiting for human intervention.

Optionally provide:
- \`updatedState\`: State updates from human input
- \`resumeFromAgent\`: Specific agent to resume from (defaults to current agent)
        `,
        params: {
          type: 'object',
          required: ['executionId'],
          properties: {
            executionId: { type: 'string', format: 'uuid', description: 'Execution ID' },
          },
        },
        body: {
          type: 'object',
          properties: {
            updatedState: {
              type: 'object',
              description: 'Updated RFQ state from human intervention',
            },
            resumeFromAgent: {
              type: 'string',
              enum: ['intake', 'missing-info', 'duplicate', 'prioritization', 'mto', 'auto-quote'],
              description: 'Agent to resume from',
            },
          },
        },
        response: {
          200: {
            description: 'Execution resumed',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
          400: {
            description: 'Cannot resume execution',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          404: {
            description: 'Execution not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof GetExecutionParamsSchema>;
        Body: z.infer<typeof ResumeExecutionSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const { executionId } = GetExecutionParamsSchema.parse(request.params);
      const body = ResumeExecutionSchema.parse(request.body);

      await executionService.resume(executionId, {
        updatedState: body.updatedState as any,
        resumeFromAgent: body.resumeFromAgent as AgentName,
      });

      return reply.send({
        success: true,
        message: 'Execution resumed',
      });
    }
  );

  // Replay execution from a specific agent
  fastify.post(
    '/executions/:executionId/replay',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Replay execution',
        description: `
Create a new execution by replaying from a specific agent in the pipeline.

This creates a fork of the original execution, preserving the state up to the specified agent.
        `,
        params: {
          type: 'object',
          required: ['executionId'],
          properties: {
            executionId: { type: 'string', format: 'uuid', description: 'Original execution ID' },
          },
        },
        body: {
          type: 'object',
          required: ['fromAgent'],
          properties: {
            fromAgent: {
              type: 'string',
              enum: ['intake', 'missing-info', 'duplicate', 'prioritization', 'mto', 'auto-quote'],
              description: 'Agent to replay from',
            },
          },
        },
        response: {
          201: {
            description: 'New execution created from replay',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              newExecutionId: { type: 'string', format: 'uuid' },
              replayedFrom: { type: 'string', format: 'uuid' },
              fromAgent: { type: 'string' },
            },
          },
          404: {
            description: 'Original execution not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof GetExecutionParamsSchema>;
        Body: z.infer<typeof ReplayExecutionSchema>;
      }>,
      reply: FastifyReply
    ) => {
      const { executionId } = GetExecutionParamsSchema.parse(request.params);
      const body = ReplayExecutionSchema.parse(request.body);

      const newExecutionId = await executionService.replay(
        executionId,
        body.fromAgent
      );

      return reply.status(201).send({
        success: true,
        newExecutionId,
        replayedFrom: executionId,
        fromAgent: body.fromAgent,
      });
    }
  );

  // Cancel execution
  fastify.post(
    '/executions/:executionId/cancel',
    {
      schema: {
        tags: ['Executions'],
        summary: 'Cancel execution',
        description: 'Cancel an in-progress execution',
        params: {
          type: 'object',
          required: ['executionId'],
          properties: {
            executionId: { type: 'string', format: 'uuid', description: 'Execution ID' },
          },
        },
        response: {
          200: {
            description: 'Execution cancelled',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
          404: {
            description: 'Execution not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: z.infer<typeof GetExecutionParamsSchema> }>,
      reply: FastifyReply
    ) => {
      const { executionId } = GetExecutionParamsSchema.parse(request.params);
      await executionService.cancel(executionId);

      return reply.send({
        success: true,
        message: 'Execution cancelled',
      });
    }
  );

  // Get available agents in pipeline
  fastify.get(
    '/agents',
    {
      schema: {
        tags: ['Agents'],
        summary: 'List agents',
        description: 'Get list of all agents in the processing pipeline with their descriptions',
        response: {
          200: {
            description: 'List of agents',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              agents: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    order: { type: 'integer' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      return reply.send({
        success: true,
        agents: AGENT_PIPELINE.map((name, index) => ({
          name,
          order: index + 1,
          description: getAgentDescription(name),
        })),
      });
    }
  );
}

function getAgentDescription(name: AgentName): string {
  const descriptions: Record<AgentName, string> = {
    intake: 'Parse incoming RFQ emails and extract structured data',
    'missing-info': 'Identify missing information and generate clarification requests',
    duplicate: 'Detect duplicate or similar RFQ requests',
    prioritization: 'Classify complexity and assign priority',
    mto: 'Generate Material Take-Off drafts',
    'auto-quote': 'Generate quotes for low/medium complexity requests',
  };
  return descriptions[name];
}

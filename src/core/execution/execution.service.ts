import { ExecutionStatus } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { RfqState, AgentName, AGENT_PIPELINE } from '../../shared/types/index.js';
import { queueService } from '../queue/queue.service.js';
import { eventService } from '../events/event.service.js';
import { stateService } from '../state/state.service.js';
import { logger } from '../../shared/utils/logger.js';
import { NotFoundError, ValidationError } from '../../shared/utils/errors.js';
import { v4 as uuidv4 } from 'uuid';

export interface CreateExecutionInput {
  emailId: string;
  externalRef?: string;
  metadata?: Record<string, unknown>;
}

export class ExecutionService {
  /**
   * Create a new execution for an email and enqueue the first agent
   */
  async create(input: CreateExecutionInput): Promise<string> {
    // Verify email exists
    const email = await prisma.email.findUnique({
      where: { id: input.emailId },
    });

    if (!email) {
      throw new NotFoundError('Email', input.emailId);
    }

    const execution = await prisma.execution.create({
      data: {
        emailId: input.emailId,
        externalRef: input.externalRef,
        metadata: (input.metadata || {}) as object,
        status: 'PENDING',
        currentAgent: 'intake',
      },
    });

    // Record creation event
    await eventService.save({
      id: uuidv4(),
      executionId: execution.id,
      eventType: 'EXECUTION_CREATED',
      eventData: { emailId: input.emailId },
      createdAt: new Date(),
    });

    // Enqueue the first agent
    await queueService.enqueue('intake', { executionId: execution.id });

    logger.info(
      { executionId: execution.id, emailId: input.emailId },
      'Execution created'
    );

    return execution.id;
  }

  /**
   * Get execution by ID with related data
   */
  async getById(executionId: string) {
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        email: {
          include: {
            attachments: true,
          },
        },
        agentTasks: {
          orderBy: { createdAt: 'asc' },
        },
        snapshots: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!execution) {
      throw new NotFoundError('Execution', executionId);
    }

    return execution;
  }

  /**
   * Get full execution history including all events
   */
  async getHistory(executionId: string) {
    const [execution, tasks, events, snapshots] = await Promise.all([
      prisma.execution.findUnique({
        where: { id: executionId },
        include: {
          email: true,
        },
      }),
      prisma.agentTask.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.event.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.rfqSnapshot.findMany({
        where: { executionId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    if (!execution) {
      throw new NotFoundError('Execution', executionId);
    }

    return { execution, tasks, events, snapshots };
  }

  /**
   * Update execution status
   */
  async updateStatus(
    executionId: string,
    status: ExecutionStatus,
    metadata?: Record<string, unknown>
  ) {
    const updateData: {
      status: ExecutionStatus;
      completedAt?: Date;
      metadata?: object;
    } = { status };

    if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') {
      updateData.completedAt = new Date();
    }

    if (metadata) {
      const current = await prisma.execution.findUnique({
        where: { id: executionId },
        select: { metadata: true },
      });
      updateData.metadata = { ...((current?.metadata as object) || {}), ...metadata };
    }

    return prisma.execution.update({
      where: { id: executionId },
      data: updateData,
    });
  }

  /**
   * Update current agent
   */
  async updateCurrentAgent(executionId: string, agentName: AgentName) {
    return prisma.execution.update({
      where: { id: executionId },
      data: { currentAgent: agentName },
    });
  }

  /**
   * Resume execution after human intervention
   */
  async resume(
    executionId: string,
    options: {
      updatedState?: Partial<RfqState>;
      resumeFromAgent?: AgentName;
    }
  ): Promise<void> {
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      throw new NotFoundError('Execution', executionId);
    }

    if (execution.status !== 'AWAITING_HUMAN') {
      throw new ValidationError(
        `Execution is not awaiting human input. Current status: ${execution.status}`
      );
    }

    // Apply human-provided state updates
    if (options.updatedState) {
      const currentState = await stateService.getLatestSnapshot(executionId);
      const mergedState = stateService.mergeState(
        currentState || {},
        options.updatedState
      );

      await stateService.createSnapshot(
        executionId,
        'human',
        'HUMAN_UPDATE',
        mergedState
      );

      await eventService.save({
        id: uuidv4(),
        executionId,
        eventType: 'HUMAN_INPUT_RECEIVED',
        eventData: { updatedFields: Object.keys(options.updatedState) },
        createdAt: new Date(),
      });
    }

    // Resume from specified agent or current
    const targetAgent =
      options.resumeFromAgent || (execution.currentAgent as AgentName);

    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: 'PROCESSING',
        currentAgent: targetAgent,
      },
    });

    await eventService.save({
      id: uuidv4(),
      executionId,
      eventType: 'EXECUTION_RESUMED',
      eventData: { resumedFrom: targetAgent },
      createdAt: new Date(),
    });

    await queueService.enqueue(targetAgent, { executionId });

    logger.info({ executionId, agent: targetAgent }, 'Execution resumed');
  }

  /**
   * Replay execution from a specific agent
   */
  async replay(executionId: string, fromAgent: AgentName): Promise<string> {
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
      include: {
        snapshots: {
          where: { agentName: fromAgent, snapshotType: 'INPUT' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!execution) {
      throw new NotFoundError('Execution', executionId);
    }

    // Validate fromAgent is in pipeline
    if (!AGENT_PIPELINE.includes(fromAgent)) {
      throw new ValidationError(`Invalid agent name: ${fromAgent}`);
    }

    // Create a new execution as a fork
    const newExecution = await prisma.execution.create({
      data: {
        emailId: execution.emailId,
        externalRef: execution.externalRef,
        metadata: {
          ...((execution.metadata as object) || {}),
          replayedFrom: executionId,
          replayedFromAgent: fromAgent,
        },
        status: 'PENDING',
        currentAgent: fromAgent,
      },
    });

    // Copy the input snapshot if exists
    if (execution.snapshots.length > 0) {
      await stateService.createSnapshot(
        newExecution.id,
        fromAgent,
        'INPUT',
        execution.snapshots[0].data as RfqState
      );
    }

    await eventService.save({
      id: uuidv4(),
      executionId: newExecution.id,
      eventType: 'EXECUTION_CREATED',
      eventData: { replayedFrom: executionId, fromAgent },
      createdAt: new Date(),
    });

    await queueService.enqueue(fromAgent, { executionId: newExecution.id });

    logger.info(
      {
        originalExecutionId: executionId,
        newExecutionId: newExecution.id,
        fromAgent,
      },
      'Execution replayed'
    );

    return newExecution.id;
  }

  /**
   * Cancel an execution
   */
  async cancel(executionId: string): Promise<void> {
    const execution = await prisma.execution.findUnique({
      where: { id: executionId },
    });

    if (!execution) {
      throw new NotFoundError('Execution', executionId);
    }

    if (execution.status === 'COMPLETED' || execution.status === 'CANCELLED') {
      throw new ValidationError(
        `Cannot cancel execution with status: ${execution.status}`
      );
    }

    await prisma.execution.update({
      where: { id: executionId },
      data: { status: 'CANCELLED', completedAt: new Date() },
    });

    await eventService.save({
      id: uuidv4(),
      executionId,
      eventType: 'EXECUTION_CANCELLED',
      eventData: {},
      createdAt: new Date(),
    });

    logger.info({ executionId }, 'Execution cancelled');
  }

  /**
   * List executions with filtering and pagination
   */
  async list(options: {
    status?: ExecutionStatus;
    emailId?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'createdAt' | 'updatedAt';
    order?: 'asc' | 'desc';
  }) {
    const {
      status,
      emailId,
      limit = 20,
      offset = 0,
      orderBy = 'createdAt',
      order = 'desc',
    } = options;

    const where: { status?: ExecutionStatus; emailId?: string } = {};
    if (status) where.status = status;
    if (emailId) where.emailId = emailId;

    const [executions, total] = await Promise.all([
      prisma.execution.findMany({
        where,
        include: {
          email: {
            select: {
              id: true,
              subject: true,
              senderEmail: true,
            },
          },
          agentTasks: {
            select: {
              id: true,
              agentName: true,
              status: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { [orderBy]: order },
        take: limit,
        skip: offset,
      }),
      prisma.execution.count({ where }),
    ]);

    return {
      executions,
      total,
      limit,
      offset,
    };
  }

  /**
   * Get executions for a specific email
   */
  async getByEmailId(emailId: string) {
    return prisma.execution.findMany({
      where: { emailId },
      include: {
        agentTasks: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}

export const executionService = new ExecutionService();

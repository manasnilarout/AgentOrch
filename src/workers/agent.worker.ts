import { Worker, Job } from 'bullmq';
import { prisma } from '../db/client.js';
import { createAgent } from '../agents/index.js';
import { AgentName, AGENT_PIPELINE, AgentContext, RfqState } from '../shared/types/index.js';
import { queueService, JobData } from '../core/queue/queue.service.js';
import { eventService } from '../core/events/event.service.js';
import { stateService } from '../core/state/state.service.js';
import { redisConnection } from '../config/queue.config.js';
import { config } from '../config/index.js';
import { logger } from '../shared/utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Create a worker for a specific agent
 */
export function createAgentWorker(agentName: AgentName): Worker {
  return new Worker<JobData>(
    agentName,
    async (job: Job<JobData>) => {
      const { executionId } = job.data;

      logger.info({ executionId, agent: agentName, jobId: job.id }, 'Processing job');

      // 1. Load execution from database
      const execution = await prisma.execution.findUniqueOrThrow({
        where: { id: executionId },
        include: {
          email: {
            include: {
              attachments: true,
            },
          },
          snapshots: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      // 2. Update execution status to PROCESSING
      await prisma.execution.update({
        where: { id: executionId },
        data: { status: 'PROCESSING' },
      });

      // 3. Build current state from latest snapshot
      const latestSnapshot = execution.snapshots[0];
      const currentState: RfqState = latestSnapshot ? (latestSnapshot.data as RfqState) : {};

      // 4. Build agent context
      const context: AgentContext = {
        executionId,
        input: {
          emailId: execution.emailId,
          emailBody: execution.email.body,
          senderEmail: execution.email.senderEmail,
          receivedAt: execution.email.receivedAt,
          attachments: execution.email.attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            originalName: a.originalName,
            mimeType: a.mimeType,
            size: a.size,
            bucketName: a.bucketName,
            objectKey: a.objectKey,
          })),
        },
        currentState,
        attempt: job.attemptsMade + 1,
        workingDir: process.cwd(),
      };

      // 5. Create agent task record
      const agentTask = await prisma.agentTask.create({
        data: {
          executionId,
          agentName,
          attemptNumber: context.attempt,
          status: 'PROCESSING',
          startedAt: new Date(),
          inputSnapshotId: latestSnapshot?.id,
        },
      });

      // 6. Instantiate and execute agent
      const agent = createAgent(agentName);
      const result = await agent.execute(context);

      // 7. Save output snapshot
      const mergedState = stateService.mergeState(currentState, result.outputState);
      const outputSnapshotId = await stateService.createSnapshot(
        executionId,
        agentName,
        'OUTPUT',
        mergedState
      );

      // 8. Save events
      await eventService.saveMany(
        result.events.map((e) => ({
          ...e,
          executionId,
          agentTaskId: agentTask.id,
        }))
      );

      // 9. Update agent task
      await prisma.agentTask.update({
        where: { id: agentTask.id },
        data: {
          status: result.success ? 'COMPLETED' : 'FAILED',
          completedAt: new Date(),
          outputSnapshotId,
          durationMs: result.metadata?.durationMs,
          tokenUsage: result.metadata?.tokenUsage as object,
          costUsd: result.metadata?.costUsd,
          errorMessage: result.success
            ? null
            : result.nextAction.type === 'FAIL'
              ? result.nextAction.error
              : null,
        },
      });

      // 10. Handle next action
      switch (result.nextAction.type) {
        case 'CONTINUE':
          await prisma.execution.update({
            where: { id: executionId },
            data: { currentAgent: result.nextAction.nextAgent },
          });
          await queueService.enqueue(result.nextAction.nextAgent, { executionId });
          break;

        case 'SKIP':
          await prisma.execution.update({
            where: { id: executionId },
            data: { currentAgent: result.nextAction.nextAgent },
          });
          await queueService.enqueue(result.nextAction.nextAgent, { executionId });
          logger.info(
            { executionId, skippedAgent: agentName, reason: result.nextAction.reason },
            'Agent skipped'
          );
          break;

        case 'AWAIT_HUMAN':
          await prisma.execution.update({
            where: { id: executionId },
            data: {
              status: 'AWAITING_HUMAN',
              metadata: {
                ...((execution.metadata as object) || {}),
                awaitingReason: result.nextAction.reason,
                requiredFields: result.nextAction.requiredFields,
              },
            },
          });
          await eventService.save({
            id: uuidv4(),
            executionId,
            eventType: 'HUMAN_INTERVENTION_REQUIRED',
            eventData: {
              reason: result.nextAction.reason,
              requiredFields: result.nextAction.requiredFields,
            },
            createdAt: new Date(),
          });
          break;

        case 'COMPLETE':
          await prisma.execution.update({
            where: { id: executionId },
            data: {
              status: 'COMPLETED',
              completedAt: new Date(),
            },
          });
          await eventService.save({
            id: uuidv4(),
            executionId,
            eventType: 'EXECUTION_COMPLETED',
            eventData: {},
            createdAt: new Date(),
          });
          break;

        case 'FAIL':
          await prisma.execution.update({
            where: { id: executionId },
            data: {
              status: 'FAILED',
              metadata: {
                ...((execution.metadata as object) || {}),
                error: result.nextAction.error,
              },
            },
          });
          await eventService.save({
            id: uuidv4(),
            executionId,
            eventType: 'EXECUTION_FAILED',
            eventData: { error: result.nextAction.error },
            createdAt: new Date(),
          });
          break;
      }

      return result;
    },
    {
      connection: redisConnection,
      concurrency: config.agent.concurrency,
    }
  );
}

/**
 * Start all agent workers
 */
export function startAllWorkers(): Worker[] {
  const workers: Worker[] = [];

  for (const agentName of AGENT_PIPELINE) {
    const worker = createAgentWorker(agentName);

    worker.on('completed', (job) => {
      logger.info({ jobId: job.id, agent: agentName }, 'Job completed');
    });

    worker.on('failed', (job, err) => {
      logger.error({ jobId: job?.id, agent: agentName, error: err.message }, 'Job failed');
    });

    worker.on('error', (err) => {
      logger.error({ agent: agentName, error: err.message }, 'Worker error');
    });

    workers.push(worker);
    logger.info({ agent: agentName }, 'Worker started');
  }

  return workers;
}

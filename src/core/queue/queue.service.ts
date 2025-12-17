import { Queue, QueueEvents } from 'bullmq';
import { AgentName } from '../../shared/types/agent.types.js';
import { redisConnection } from '../../config/queue.config.js';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';

export interface JobData {
  executionId: string;
}

export class QueueService {
  private queues: Map<AgentName, Queue<JobData>> = new Map();
  private queueEvents: Map<AgentName, QueueEvents> = new Map();
  private initialized = false;

  /**
   * Initialize all agent queues
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const agentNames: AgentName[] = [
      'intake',
      'missing-info',
      'duplicate',
      'prioritization',
      'mto',
      'auto-quote',
    ];

    for (const agentName of agentNames) {
      const queue = new Queue<JobData>(agentName, {
        connection: redisConnection,
        defaultJobOptions: {
          attempts: config.queue.jobAttempts,
          backoff: {
            type: 'exponential',
            delay: config.queue.backoffDelay,
          },
          removeOnComplete: 100,
          removeOnFail: 1000,
        },
      });

      const events = new QueueEvents(agentName, { connection: redisConnection });

      this.queues.set(agentName, queue);
      this.queueEvents.set(agentName, events);

      logger.info({ agent: agentName }, 'Queue initialized');
    }

    this.initialized = true;
    logger.info('Queue service initialized');
  }

  /**
   * Add a job to the specified agent's queue
   */
  async enqueue(agentName: AgentName, data: JobData): Promise<string> {
    const queue = this.queues.get(agentName);
    if (!queue) {
      throw new Error(`Queue not found for agent: ${agentName}`);
    }

    const job = await queue.add(agentName, data, {
      jobId: `${data.executionId}-${agentName}-${Date.now()}`,
    });

    logger.info(
      { executionId: data.executionId, agent: agentName, jobId: job.id },
      'Job enqueued'
    );

    return job.id!;
  }

  /**
   * Get a queue by agent name
   */
  getQueue(agentName: AgentName): Queue<JobData> | undefined {
    return this.queues.get(agentName);
  }

  /**
   * Get queue events for an agent
   */
  getQueueEvents(agentName: AgentName): QueueEvents | undefined {
    return this.queueEvents.get(agentName);
  }

  /**
   * Get job counts for all queues
   */
  async getJobCounts(): Promise<Record<AgentName, {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }>> {
    const counts: Record<string, {
      waiting: number;
      active: number;
      completed: number;
      failed: number;
      delayed: number;
    }> = {};

    for (const [name, queue] of this.queues) {
      const jobCounts = await queue.getJobCounts();
      counts[name] = {
        waiting: jobCounts.waiting,
        active: jobCounts.active,
        completed: jobCounts.completed,
        failed: jobCounts.failed,
        delayed: jobCounts.delayed,
      };
    }

    return counts as Record<AgentName, typeof counts[string]>;
  }

  /**
   * Drain a queue (remove all jobs)
   */
  async drainQueue(agentName: AgentName): Promise<void> {
    const queue = this.queues.get(agentName);
    if (queue) {
      await queue.drain();
      logger.info({ agent: agentName }, 'Queue drained');
    }
  }

  /**
   * Close all queues gracefully
   */
  async close(): Promise<void> {
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.info({ agent: name }, 'Queue closed');
    }

    for (const [, events] of this.queueEvents) {
      await events.close();
    }

    this.initialized = false;
    logger.info('Queue service closed');
  }

  /**
   * Check if service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      const queue = this.queues.get('intake');
      if (!queue) return false;
      await queue.getJobCounts();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const queueService = new QueueService();

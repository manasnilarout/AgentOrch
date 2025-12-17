import { prisma } from '../../db/client.js';
import { DomainEvent } from '../../shared/types/agent.types.js';
import { logger } from '../../shared/utils/logger.js';

export class EventService {
  /**
   * Save a single event
   */
  async save(
    event: DomainEvent & { executionId: string; agentTaskId?: string }
  ): Promise<string> {
    const created = await prisma.event.create({
      data: {
        id: event.id,
        executionId: event.executionId,
        agentTaskId: event.agentTaskId,
        eventType: event.eventType,
        eventData: event.eventData as object,
        createdAt: event.createdAt,
      },
    });

    logger.debug(
      { eventId: created.id, eventType: event.eventType },
      'Event saved'
    );

    return created.id;
  }

  /**
   * Save multiple events in a transaction
   */
  async saveMany(
    events: Array<DomainEvent & { executionId: string; agentTaskId?: string }>
  ): Promise<number> {
    if (events.length === 0) return 0;

    const result = await prisma.event.createMany({
      data: events.map((event) => ({
        id: event.id,
        executionId: event.executionId,
        agentTaskId: event.agentTaskId,
        eventType: event.eventType,
        eventData: event.eventData as object,
        createdAt: event.createdAt,
      })),
    });

    logger.debug({ count: result.count }, 'Events saved');

    return result.count;
  }

  /**
   * Get all events for an execution
   */
  async getByExecutionId(executionId: string) {
    return prisma.event.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get events by type
   */
  async getByType(executionId: string, eventType: string) {
    return prisma.event.findMany({
      where: { executionId, eventType },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get events for a specific agent task
   */
  async getByAgentTaskId(agentTaskId: string) {
    return prisma.event.findMany({
      where: { agentTaskId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get events within a time range
   */
  async getByTimeRange(
    executionId: string,
    startTime: Date,
    endTime: Date
  ) {
    return prisma.event.findMany({
      where: {
        executionId,
        createdAt: {
          gte: startTime,
          lte: endTime,
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Count events by type for an execution
   */
  async countByType(executionId: string) {
    const result = await prisma.event.groupBy({
      by: ['eventType'],
      where: { executionId },
      _count: {
        eventType: true,
      },
    });

    return result.reduce<Record<string, number>>(
      (acc, item) => {
        acc[item.eventType] = item._count.eventType;
        return acc;
      },
      {}
    );
  }
}

export const eventService = new EventService();

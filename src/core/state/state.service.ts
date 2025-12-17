import { SnapshotType } from '@prisma/client';
import { prisma } from '../../db/client.js';
import { RfqState, AgentName } from '../../shared/types/index.js';
import { logger } from '../../shared/utils/logger.js';

export class StateService {
  /**
   * Create a new snapshot
   */
  async createSnapshot(
    executionId: string,
    agentName: string,
    snapshotType: SnapshotType,
    data: RfqState
  ): Promise<string> {
    const snapshot = await prisma.rfqSnapshot.create({
      data: {
        executionId,
        agentName,
        snapshotType,
        data: data as object,
      },
    });

    logger.debug(
      { executionId, agentName, snapshotType, snapshotId: snapshot.id },
      'Snapshot created'
    );

    return snapshot.id;
  }

  /**
   * Get the latest snapshot for an execution
   */
  async getLatestSnapshot(executionId: string): Promise<RfqState | null> {
    const snapshot = await prisma.rfqSnapshot.findFirst({
      where: { executionId },
      orderBy: { createdAt: 'desc' },
    });

    return snapshot ? (snapshot.data as RfqState) : null;
  }

  /**
   * Get the latest output snapshot for a specific agent
   */
  async getAgentOutputSnapshot(
    executionId: string,
    agentName: AgentName
  ): Promise<RfqState | null> {
    const snapshot = await prisma.rfqSnapshot.findFirst({
      where: {
        executionId,
        agentName,
        snapshotType: 'OUTPUT',
      },
      orderBy: { createdAt: 'desc' },
    });

    return snapshot ? (snapshot.data as RfqState) : null;
  }

  /**
   * Get all snapshots for an execution
   */
  async getAllSnapshots(executionId: string) {
    return prisma.rfqSnapshot.findMany({
      where: { executionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Get snapshots by agent
   */
  async getSnapshotsByAgent(executionId: string, agentName: string) {
    return prisma.rfqSnapshot.findMany({
      where: { executionId, agentName },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * Merge state updates with existing state
   */
  mergeState(currentState: RfqState, updates: Partial<RfqState>): RfqState {
    return {
      ...currentState,
      ...updates,
      parsedData: updates.parsedData
        ? { ...currentState.parsedData, ...updates.parsedData }
        : currentState.parsedData,
      duplicateCheckResult: updates.duplicateCheckResult
        ? { ...currentState.duplicateCheckResult, ...updates.duplicateCheckResult }
        : currentState.duplicateCheckResult,
      mtoData: updates.mtoData
        ? { ...currentState.mtoData, ...updates.mtoData }
        : currentState.mtoData,
      quote: updates.quote
        ? { ...currentState.quote, ...updates.quote }
        : currentState.quote,
    };
  }

  /**
   * Get state at a specific point in time (before or at given snapshot)
   */
  async getStateAtSnapshot(snapshotId: string): Promise<RfqState | null> {
    const snapshot = await prisma.rfqSnapshot.findUnique({
      where: { id: snapshotId },
    });

    return snapshot ? (snapshot.data as RfqState) : null;
  }

  /**
   * Delete all snapshots for an execution
   */
  async deleteExecutionSnapshots(executionId: string): Promise<number> {
    const result = await prisma.rfqSnapshot.deleteMany({
      where: { executionId },
    });

    logger.info(
      { executionId, count: result.count },
      'Execution snapshots deleted'
    );

    return result.count;
  }
}

export const stateService = new StateService();

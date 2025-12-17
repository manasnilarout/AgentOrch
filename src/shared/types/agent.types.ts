import { RfqState, RfqInput } from './rfq.types.js';

/**
 * Agent names in the pipeline
 */
export type AgentName =
  | 'intake'
  | 'missing-info'
  | 'duplicate'
  | 'prioritization'
  | 'mto'
  | 'auto-quote';

/**
 * Ordered list of agents in the pipeline
 */
export const AGENT_PIPELINE: AgentName[] = [
  'intake',
  'missing-info',
  'duplicate',
  'prioritization',
  'mto',
  'auto-quote',
];

/**
 * Context passed to each agent during execution
 */
export interface AgentContext {
  executionId: string;
  input: RfqInput;
  currentState: RfqState;
  attempt: number;
  workingDir: string;
}

/**
 * Possible next actions after agent execution
 */
export type NextAction =
  | { type: 'CONTINUE'; nextAgent: AgentName }
  | { type: 'AWAIT_HUMAN'; reason: string; requiredFields?: string[] }
  | { type: 'COMPLETE' }
  | { type: 'FAIL'; error: string }
  | { type: 'SKIP'; reason: string; nextAgent: AgentName };

/**
 * Domain event for audit trail
 */
export interface DomainEvent {
  id: string;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: Date;
}

/**
 * Result returned by agent execution
 */
export interface AgentResult<TOutput = unknown> {
  success: boolean;
  outputState: Partial<RfqState>;
  events: DomainEvent[];
  nextAction: NextAction;
  agentOutput?: TOutput;
  metadata?: {
    durationMs?: number;
    tokenUsage?: TokenUsage;
    costUsd?: number;
  };
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
}

/**
 * Event types for audit trail
 */
export const EVENT_TYPES = {
  EXECUTION_CREATED: 'EXECUTION_CREATED',
  EXECUTION_COMPLETED: 'EXECUTION_COMPLETED',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  EXECUTION_CANCELLED: 'EXECUTION_CANCELLED',
  AGENT_STARTED: 'AGENT_STARTED',
  AGENT_COMPLETED: 'AGENT_COMPLETED',
  AGENT_FAILED: 'AGENT_FAILED',
  HUMAN_INTERVENTION_REQUIRED: 'HUMAN_INTERVENTION_REQUIRED',
  HUMAN_INPUT_RECEIVED: 'HUMAN_INPUT_RECEIVED',
  EXECUTION_RESUMED: 'EXECUTION_RESUMED',
  STATE_SNAPSHOT_CREATED: 'STATE_SNAPSHOT_CREATED',
  TOOL_INVOKED: 'TOOL_INVOKED',
  TOOL_COMPLETED: 'TOOL_COMPLETED',
  TOOL_FAILED: 'TOOL_FAILED',
} as const;

export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

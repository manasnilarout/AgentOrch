export * from './base/index.js';
export * from './intake/index.js';
export * from './missing-info/index.js';
export * from './duplicate/index.js';
export * from './prioritization/index.js';
export * from './mto/index.js';
export * from './auto-quote/index.js';

import { BaseAgent } from './base/base-agent.js';
import { IntakeAgent } from './intake/intake.agent.js';
import { MissingInfoAgent } from './missing-info/missing-info.agent.js';
import { DuplicateAgent } from './duplicate/duplicate.agent.js';
import { PrioritizationAgent } from './prioritization/prioritization.agent.js';
import { MtoAgent } from './mto/mto.agent.js';
import { AutoQuoteAgent } from './auto-quote/auto-quote.agent.js';
import { AgentName } from '../shared/types/agent.types.js';

// Agent factory registry
export const agentFactory: Record<AgentName, () => BaseAgent> = {
  intake: () => new IntakeAgent(),
  'missing-info': () => new MissingInfoAgent(),
  duplicate: () => new DuplicateAgent(),
  prioritization: () => new PrioritizationAgent(),
  mto: () => new MtoAgent(),
  'auto-quote': () => new AutoQuoteAgent(),
};

/**
 * Create an agent instance by name
 */
export function createAgent(name: AgentName): BaseAgent {
  const factory = agentFactory[name];
  if (!factory) {
    throw new Error(`Unknown agent: ${name}`);
  }
  return factory();
}

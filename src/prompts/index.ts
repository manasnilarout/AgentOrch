import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { initializeTemplates, renderPrompt } from './engine.js';
import {
  IntakeSystemContext,
  IntakeUserContext,
  MissingInfoSystemContext,
  MissingInfoUserContext,
  DuplicateSystemContext,
  DuplicateUserContext,
  PrioritizationSystemContext,
  PrioritizationUserContext,
  MtoSystemContext,
  MtoUserContext,
  AutoQuoteSystemContext,
  AutoQuoteUserContext,
} from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize templates
const TEMPLATES_DIR = join(__dirname, 'templates');
initializeTemplates(TEMPLATES_DIR);

/**
 * Type-safe prompt accessors for all agents
 */
export const prompts = {
  intake: {
    system: (ctx: IntakeSystemContext) => renderPrompt('intake.system', ctx),
    user: (ctx: IntakeUserContext) => renderPrompt('intake.user', ctx),
  },
  missingInfo: {
    system: (ctx: MissingInfoSystemContext) => renderPrompt('missing-info.system', ctx),
    user: (ctx: MissingInfoUserContext) => renderPrompt('missing-info.user', ctx),
  },
  duplicate: {
    system: (ctx: DuplicateSystemContext) => renderPrompt('duplicate.system', ctx),
    user: (ctx: DuplicateUserContext) => renderPrompt('duplicate.user', ctx),
  },
  prioritization: {
    system: (ctx: PrioritizationSystemContext) => renderPrompt('prioritization.system', ctx),
    user: (ctx: PrioritizationUserContext) => renderPrompt('prioritization.user', ctx),
  },
  mto: {
    system: (ctx: MtoSystemContext) => renderPrompt('mto.system', ctx),
    user: (ctx: MtoUserContext) => renderPrompt('mto.user', ctx),
  },
  autoQuote: {
    system: (ctx: AutoQuoteSystemContext) => renderPrompt('auto-quote.system', ctx),
    user: (ctx: AutoQuoteUserContext) => renderPrompt('auto-quote.user', ctx),
  },
};

export * from './types.js';
export * from './engine.js';

import { z } from 'zod';
import { BaseAgent } from '../base/base-agent.js';
import { AgentContext, NextAction } from '../../shared/types/agent.types.js';
import { RfqState } from '../../shared/types/rfq.types.js';
import { prompts } from '../../prompts/index.js';

export const DuplicateOutputSchema = z.object({
  isDuplicate: z.boolean(),
  similarRfqIds: z.array(z.string()).optional(),
  similarityScore: z.number().min(0).max(1).optional(),
  matchDetails: z
    .object({
      customerMatch: z.boolean(),
      projectMatch: z.boolean(),
      productOverlap: z.number(),
      notes: z.string().optional(),
    })
    .optional(),
  recommendation: z.enum(['PROCESS', 'MERGE', 'SKIP']),
  recommendationReason: z.string(),
});

export type DuplicateOutput = z.infer<typeof DuplicateOutputSchema>;

export class DuplicateAgent extends BaseAgent<DuplicateOutput> {
  constructor() {
    super('duplicate');
  }

  protected initializeTools(context: AgentContext): void {
    // Tool to search for similar RFQs
    this.registerTool(
      'search_similar_rfqs',
      'Search the database for similar RFQs based on customer, project, or products',
      {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Customer name to search for' },
          project_name: { type: 'string', description: 'Project name to search for' },
          sender_email: { type: 'string', description: 'Sender email to search for' },
        },
      },
      async (input) => {
        // Placeholder - would integrate with actual database search
        return JSON.stringify({
          found: 0,
          results: [],
          message: 'No similar RFQs found in the last 30 days',
        });
      }
    );
  }

  protected buildSystemPrompt(context: AgentContext): string {
    return prompts.duplicate.system({
      companyName: 'Oldcastle BuildingEnvelope',
      similarityThreshold: 80,
      lookbackDays: 30,
    });
  }

  protected buildUserPrompt(context: AgentContext): string {
    return prompts.duplicate.user({
      parsedData: context.currentState.parsedData,
      senderEmail: context.input.senderEmail,
      recentRfqs: [], // Would be populated from database
    });
  }

  protected async parseOutput(
    response: string,
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: DuplicateOutput }> {
    const parsed = this.extractJsonFromResponse(response);
    const validated = DuplicateOutputSchema.parse(parsed);

    return {
      state: {
        duplicateCheckResult: {
          isDuplicate: validated.isDuplicate,
          similarRfqIds: validated.similarRfqIds,
          similarityScore: validated.similarityScore,
        },
      },
      output: validated,
    };
  }

  protected determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: DuplicateOutput },
    context: AgentContext
  ): NextAction {
    const { output } = parsedOutput;

    // If duplicate and recommendation is SKIP
    if (output.isDuplicate && output.recommendation === 'SKIP') {
      return this.requireHumanIntervention(
        `Potential duplicate RFQ detected: ${output.recommendationReason}`,
        ['duplicateConfirmation']
      );
    }

    // If duplicate and recommendation is MERGE
    if (output.isDuplicate && output.recommendation === 'MERGE') {
      return this.requireHumanIntervention(
        `Similar RFQ found - recommend merging: ${output.recommendationReason}`,
        ['mergeDecision']
      );
    }

    // Continue processing
    return this.continueToNextAgent();
  }
}

import { z } from 'zod';
import { BaseAgent } from '../base/base-agent.js';
import { AgentContext, NextAction } from '../../shared/types/agent.types.js';
import { RfqState } from '../../shared/types/rfq.types.js';
import { prompts } from '../../prompts/index.js';

export const PrioritizationOutputSchema = z.object({
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
  complexity: z.enum(['SIMPLE', 'MODERATE', 'COMPLEX']),
  estimatedHours: z.number(),
  reasoning: z.object({
    priorityFactors: z.array(z.string()),
    complexityFactors: z.array(z.string()),
    notes: z.string().optional(),
  }),
  autoQuoteEligible: z.boolean(),
  autoQuoteBlockers: z.array(z.string()).optional(),
});

export type PrioritizationOutput = z.infer<typeof PrioritizationOutputSchema>;

export class PrioritizationAgent extends BaseAgent<PrioritizationOutput> {
  constructor() {
    super('prioritization');
  }

  protected initializeTools(context: AgentContext): void {
    // Tool to check current capacity
    this.registerTool(
      'check_capacity',
      'Check current team capacity and workload',
      {
        type: 'object',
        properties: {},
      },
      async () => {
        // Placeholder - would integrate with actual capacity system
        return JSON.stringify({
          currentWorkload: 'moderate',
          availableCapacity: '40 hours this week',
          urgentItemsInQueue: 2,
        });
      }
    );
  }

  protected buildSystemPrompt(context: AgentContext): string {
    return prompts.prioritization.system({
      companyName: 'Oldcastle BuildingEnvelope',
      priorityRules: [
        { condition: 'Deadline within 1 week', priority: 'URGENT' },
        { condition: 'Deadline within 2 weeks', priority: 'HIGH' },
        { condition: 'Strategic customer or large project', priority: 'HIGH' },
        { condition: 'Standard request with normal timeline', priority: 'MEDIUM' },
        { condition: 'No urgency indicated', priority: 'LOW' },
      ],
      complexityRules: [
        { condition: 'Standard products, clear quantities, no customization', complexity: 'SIMPLE' },
        { condition: 'Some customization, multiple product types, special requirements', complexity: 'MODERATE' },
        { condition: 'Heavy customization, engineering required, unclear specifications', complexity: 'COMPLEX' },
      ],
    });
  }

  protected buildUserPrompt(context: AgentContext): string {
    const parsedData = context.currentState.parsedData;
    return prompts.prioritization.user({
      parsedData,
      customerName: parsedData?.customerName,
      timeline: parsedData?.timeline,
      productCount: parsedData?.requestedProducts?.length || 0,
      hasDrawings: parsedData?.requestedProducts?.some((p) => p.drawings && p.drawings.length > 0) || false,
      hasSpecialRequirements: (parsedData?.specialRequirements?.length || 0) > 0,
    });
  }

  protected async parseOutput(
    response: string,
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: PrioritizationOutput }> {
    const parsed = this.extractJsonFromResponse(response);
    const validated = PrioritizationOutputSchema.parse(parsed);

    return {
      state: {
        priority: validated.priority,
        complexity: validated.complexity,
        estimatedHours: validated.estimatedHours,
      },
      output: validated,
    };
  }

  protected determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: PrioritizationOutput },
    context: AgentContext
  ): NextAction {
    const { output } = parsedOutput;

    // If complexity is too high for auto-processing
    if (output.complexity === 'COMPLEX' && !output.autoQuoteEligible) {
      return this.requireHumanIntervention(
        'Complex RFQ requires manual handling',
        output.autoQuoteBlockers
      );
    }

    // Continue to MTO agent
    return this.continueToNextAgent();
  }
}

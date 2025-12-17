import { z } from 'zod';
import { BaseAgent } from '../base/base-agent.js';
import { AgentContext, NextAction } from '../../shared/types/agent.types.js';
import { RfqState } from '../../shared/types/rfq.types.js';
import { prompts } from '../../prompts/index.js';

export const MissingInfoOutputSchema = z.object({
  missingFields: z.array(z.string()),
  clarificationRequests: z.array(
    z.object({
      field: z.string(),
      question: z.string(),
      context: z.string().optional(),
      priority: z.enum(['HIGH', 'MEDIUM', 'LOW']),
    })
  ),
  canProceedWithQuote: z.boolean(),
  blockerReason: z.string().optional().nullable(),
});

export type MissingInfoOutput = z.infer<typeof MissingInfoOutputSchema>;

export class MissingInfoAgent extends BaseAgent<MissingInfoOutput> {
  constructor() {
    super('missing-info');
  }

  protected initializeTools(context: AgentContext): void {
    // Tool to search RFQ history for similar patterns
    this.registerTool(
      'search_rfq_history',
      'Search previous RFQs from this customer to find patterns or fill in missing information',
      {
        type: 'object',
        properties: {
          customer_email: {
            type: 'string',
            description: 'Customer email to search for',
          },
        },
        required: ['customer_email'],
      },
      async (input) => {
        // Placeholder - would integrate with actual RFQ history search
        return JSON.stringify({
          found: false,
          message: 'No previous RFQs found for this customer',
        });
      }
    );
  }

  protected buildSystemPrompt(context: AgentContext): string {
    return prompts.missingInfo.system({
      companyName: 'Oldcastle BuildingEnvelope',
      requiredFields: [
        'Customer/Company name',
        'Project name or reference',
        'Product type',
        'Quantities',
        'Specifications or drawings',
      ],
      optionalFields: [
        'Timeline/deadline',
        'Budget constraints',
        'Delivery location',
        'Special requirements',
      ],
    });
  }

  protected buildUserPrompt(context: AgentContext): string {
    return prompts.missingInfo.user({
      parsedData: context.currentState.parsedData,
      customerName: context.currentState.parsedData?.customerName,
      projectName: context.currentState.parsedData?.projectName,
    });
  }

  protected async parseOutput(
    response: string,
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: MissingInfoOutput }> {
    const parsed = this.extractJsonFromResponse(response);
    const validated = MissingInfoOutputSchema.parse(parsed);

    return {
      state: {
        missingFields: validated.missingFields,
        clarificationRequests: validated.clarificationRequests.map((r) => ({
          field: r.field,
          question: r.question,
          context: r.context,
        })),
      },
      output: validated,
    };
  }

  protected determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: MissingInfoOutput },
    context: AgentContext
  ): NextAction {
    const { output } = parsedOutput;

    // If critical information is missing and we can't proceed
    if (!output.canProceedWithQuote) {
      const highPriorityQuestions = output.clarificationRequests
        .filter((r) => r.priority === 'HIGH')
        .map((r) => r.field);

      return this.requireHumanIntervention(
        output.blockerReason || 'Critical information missing for quoting',
        highPriorityQuestions
      );
    }

    // Continue to next agent
    return this.continueToNextAgent();
  }
}

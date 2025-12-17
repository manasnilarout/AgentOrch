import { z } from 'zod';
import { BaseAgent } from '../base/base-agent.js';
import { AgentContext, NextAction } from '../../shared/types/agent.types.js';
import { RfqState } from '../../shared/types/rfq.types.js';
import { prompts } from '../../prompts/index.js';

export const AutoQuoteOutputSchema = z.object({
  quoteNumber: z.string(),
  validUntil: z.string(),
  lineItems: z.array(
    z.object({
      productCode: z.string(),
      description: z.string(),
      quantity: z.number(),
      unit: z.string(),
      unitPrice: z.number(),
      totalPrice: z.number(),
    })
  ),
  subtotal: z.number(),
  discounts: z
    .array(
      z.object({
        description: z.string(),
        amount: z.number(),
      })
    )
    .optional(),
  tax: z.number().optional(),
  total: z.number(),
  terms: z.string().optional(),
  notes: z.array(z.string()).optional(),
  requiresReview: z.boolean(),
  reviewReasons: z.array(z.string()).optional(),
});

export type AutoQuoteOutput = z.infer<typeof AutoQuoteOutputSchema>;

export class AutoQuoteAgent extends BaseAgent<AutoQuoteOutput> {
  constructor() {
    super('auto-quote');
  }

  protected initializeTools(context: AgentContext): void {
    // Tool to get current pricing
    this.registerTool(
      'get_pricing',
      'Get current pricing for a product',
      {
        type: 'object',
        properties: {
          product_code: { type: 'string', description: 'Product code' },
          quantity: { type: 'number', description: 'Quantity for volume pricing' },
        },
        required: ['product_code'],
      },
      async (input) => {
        // Placeholder - would integrate with actual pricing system
        return JSON.stringify({
          productCode: input.product_code,
          unitPrice: 150.0,
          volumeDiscount: input.quantity && (input.quantity as number) > 100 ? 5 : 0,
          currency: 'USD',
        });
      }
    );

    // Tool to apply discounts
    this.registerTool(
      'apply_discounts',
      'Check and apply applicable discounts',
      {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Customer name' },
          subtotal: { type: 'number', description: 'Order subtotal' },
          product_categories: { type: 'array', description: 'Product categories in order' },
        },
        required: ['subtotal'],
      },
      async (input) => {
        // Placeholder - would integrate with actual discount rules
        const subtotal = input.subtotal as number;
        const discounts = [];

        if (subtotal > 10000) {
          discounts.push({ type: 'volume', percentage: 5, amount: subtotal * 0.05 });
        }

        return JSON.stringify({
          applicableDiscounts: discounts,
          totalDiscount: discounts.reduce((sum, d) => sum + d.amount, 0),
        });
      }
    );

    // Tool to generate quote number
    this.registerTool(
      'generate_quote_number',
      'Generate a unique quote number',
      {
        type: 'object',
        properties: {},
      },
      async () => {
        const date = new Date();
        const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.floor(Math.random() * 10000)
          .toString()
          .padStart(4, '0');
        return `Q-${dateStr}-${random}`;
      }
    );
  }

  protected buildSystemPrompt(context: AgentContext): string {
    return prompts.autoQuote.system({
      companyName: 'Oldcastle BuildingEnvelope',
      quotePolicies: [
        'Quotes are valid for 30 days',
        'Prices are FOB factory',
        'Payment terms: Net 30',
        'Lead time: 4-6 weeks standard',
      ],
      discountRules: [
        { condition: 'Order total > $10,000', discount: 5 },
        { condition: 'Order total > $50,000', discount: 10 },
        { condition: 'Repeat customer', discount: 3 },
      ],
      taxRate: 8.25,
    });
  }

  protected buildUserPrompt(context: AgentContext): string {
    const parsedData = context.currentState.parsedData;
    const mtoData = context.currentState.mtoData;

    return prompts.autoQuote.user({
      parsedData,
      mtoData: mtoData || { lineItems: [], notes: [] },
      customerName: parsedData?.customerName,
      priority: context.currentState.priority || 'MEDIUM',
      complexity: context.currentState.complexity || 'MODERATE',
    });
  }

  protected async parseOutput(
    response: string,
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: AutoQuoteOutput }> {
    const parsed = this.extractJsonFromResponse(response);
    const validated = AutoQuoteOutputSchema.parse(parsed);

    return {
      state: {
        quote: {
          quoteNumber: validated.quoteNumber,
          validUntil: new Date(validated.validUntil),
          lineItems: validated.lineItems,
          subtotal: validated.subtotal,
          tax: validated.tax,
          total: validated.total,
          terms: validated.terms,
          notes: validated.notes,
        },
      },
      output: validated,
    };
  }

  protected determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: AutoQuoteOutput },
    context: AgentContext
  ): NextAction {
    const { output } = parsedOutput;

    // If quote requires human review
    if (output.requiresReview) {
      return this.requireHumanIntervention(
        `Quote requires review: ${output.reviewReasons?.join(', ') || 'Unknown reason'}`,
        ['quote']
      );
    }

    // Pipeline complete
    return { type: 'COMPLETE' };
  }
}

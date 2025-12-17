import { z } from 'zod';
import { BaseAgent } from '../base/base-agent.js';
import { AgentContext, NextAction } from '../../shared/types/agent.types.js';
import { RfqState } from '../../shared/types/rfq.types.js';
import { prompts } from '../../prompts/index.js';

export const MtoOutputSchema = z.object({
  lineItems: z.array(
    z.object({
      productCode: z.string(),
      description: z.string(),
      quantity: z.number(),
      unit: z.string(),
      unitPrice: z.number().optional().nullable(),
      totalPrice: z.number().optional().nullable(),
      notes: z.string().optional(),
    })
  ),
  totalEstimatedCost: z.number().optional().nullable(),
  notes: z.array(z.string()).optional(),
  unmappedItems: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1),
});

export type MtoOutput = z.infer<typeof MtoOutputSchema>;

export class MtoAgent extends BaseAgent<MtoOutput> {
  constructor() {
    super('mto');
  }

  protected initializeTools(context: AgentContext): void {
    // Tool to look up product information
    this.registerTool(
      'product_lookup',
      'Look up product details and pricing from the product catalog',
      {
        type: 'object',
        properties: {
          product_name: { type: 'string', description: 'Product name or code to look up' },
          category: { type: 'string', description: 'Product category (optional)' },
        },
        required: ['product_name'],
      },
      async (input) => {
        // Placeholder - would integrate with actual product catalog
        return JSON.stringify({
          found: true,
          product: {
            code: 'CW-1000',
            name: input.product_name,
            category: 'Curtain Wall Systems',
            basePrice: 150.0,
            unit: 'sq ft',
          },
        });
      }
    );

    // Tool to calculate quantities
    this.registerTool(
      'calculate_quantities',
      'Calculate material quantities based on dimensions or specifications',
      {
        type: 'object',
        properties: {
          product_type: { type: 'string', description: 'Type of product' },
          dimensions: { type: 'object', description: 'Dimensions (width, height, etc.)' },
          waste_factor: { type: 'number', description: 'Waste factor percentage (default 5%)' },
        },
        required: ['product_type'],
      },
      async (input) => {
        // Placeholder - would integrate with actual calculation logic
        return JSON.stringify({
          calculated: true,
          quantity: 100,
          unit: 'sq ft',
          wasteFactor: input.waste_factor || 5,
          totalWithWaste: 105,
        });
      }
    );
  }

  protected buildSystemPrompt(context: AgentContext): string {
    return prompts.mto.system({
      companyName: 'Oldcastle BuildingEnvelope',
      productCatalog: [
        { code: 'CW-1000', name: 'Curtain Wall System', category: 'Curtain Wall' },
        { code: 'SF-2000', name: 'Storefront System', category: 'Storefront' },
        { code: 'WN-3000', name: 'Window System', category: 'Windows' },
        { code: 'EN-4000', name: 'Entrance Door', category: 'Entrances' },
      ],
      unitConversions: {
        'feet_to_meters': 0.3048,
        'sqft_to_sqm': 0.0929,
      },
    });
  }

  protected buildUserPrompt(context: AgentContext): string {
    const parsedData = context.currentState.parsedData;
    return prompts.mto.user({
      parsedData,
      requestedProducts: parsedData?.requestedProducts || [],
      priority: context.currentState.priority || 'MEDIUM',
      complexity: context.currentState.complexity || 'MODERATE',
    });
  }

  protected async parseOutput(
    response: string,
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: MtoOutput }> {
    const parsed = this.extractJsonFromResponse(response);
    const validated = MtoOutputSchema.parse(parsed);

    return {
      state: {
        mtoData: {
          lineItems: validated.lineItems.map((item) => ({
            productCode: item.productCode,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice ?? undefined,
            totalPrice: item.totalPrice ?? undefined,
          })),
          totalEstimatedCost: validated.totalEstimatedCost ?? undefined,
          notes: validated.notes,
        },
      },
      output: validated,
    };
  }

  protected determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: MtoOutput },
    context: AgentContext
  ): NextAction {
    const { output } = parsedOutput;

    // If confidence is too low
    if (output.confidence < 0.7) {
      return this.requireHumanIntervention(
        'Low confidence in material take-off - please review',
        ['mtoData']
      );
    }

    // If there are unmapped items
    if (output.unmappedItems && output.unmappedItems.length > 0) {
      return this.requireHumanIntervention(
        `Some items could not be mapped to catalog: ${output.unmappedItems.join(', ')}`,
        ['unmappedItems']
      );
    }

    // Skip auto-quote for complex items
    if (context.currentState.complexity === 'COMPLEX') {
      return { type: 'COMPLETE' };
    }

    // Continue to auto-quote
    return this.continueToNextAgent();
  }
}

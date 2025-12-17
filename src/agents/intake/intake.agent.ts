import { z } from 'zod';
import { BaseAgent } from '../base/base-agent.js';
import { AgentContext, NextAction } from '../../shared/types/agent.types.js';
import { RfqState } from '../../shared/types/rfq.types.js';
import { prompts } from '../../prompts/index.js';
import { minioService } from '../../core/storage/minio.service.js';

// Zod schema for intake output validation
export const IntakeOutputSchema = z.object({
  customerName: z.string().optional().nullable(),
  projectName: z.string().optional().nullable(),
  projectReference: z.string().optional().nullable(),
  requestedProducts: z.array(
    z.object({
      name: z.string(),
      quantity: z.number().optional().nullable(),
      unit: z.string().optional().nullable(),
      specifications: z.record(z.unknown()).optional().nullable(),
      drawings: z.array(z.string()).optional().nullable(),
    })
  ),
  timeline: z.string().optional().nullable(),
  specialRequirements: z.array(z.string()).optional().nullable(),
  extractedFromAttachments: z.array(z.string()).optional().nullable(),
  confidence: z.number().min(0).max(1),
  uncertainFields: z.array(z.string()).optional().nullable(),
});

export type IntakeOutput = z.infer<typeof IntakeOutputSchema>;

export class IntakeAgent extends BaseAgent<IntakeOutput> {
  constructor() {
    super('intake');
  }

  protected initializeTools(context: AgentContext): void {
    // Tool to read attachment content
    this.registerTool(
      'read_attachment',
      'Read the contents of an attachment file. Supports text files, PDFs, and other document formats.',
      {
        type: 'object',
        properties: {
          attachment_id: {
            type: 'string',
            description: 'The ID of the attachment to read',
          },
        },
        required: ['attachment_id'],
      },
      async (input) => {
        const attachmentId = input.attachment_id as string;
        const attachment = context.input.attachments.find((a) => a.id === attachmentId);

        if (!attachment) {
          return `Attachment with ID ${attachmentId} not found`;
        }

        try {
          const buffer = await minioService.downloadFileAsBuffer(attachment.objectKey);

          // For text-based files, return as string
          if (
            attachment.mimeType.startsWith('text/') ||
            attachment.mimeType === 'application/json'
          ) {
            return buffer.toString('utf-8');
          }

          // For PDFs and other binary files, return metadata and indicate it needs processing
          return `File: ${attachment.originalName}\nType: ${attachment.mimeType}\nSize: ${attachment.size} bytes\n\nNote: This is a binary file (${attachment.mimeType}). For PDF/image content extraction, please describe what information you need and I'll help extract it.`;
        } catch (error) {
          return `Error reading attachment: ${error instanceof Error ? error.message : 'Unknown error'}`;
        }
      }
    );

    // Tool to list all attachments
    this.registerTool(
      'list_attachments',
      'List all available attachments for this RFQ email',
      {
        type: 'object',
        properties: {},
      },
      async () => {
        const attachments = context.input.attachments;
        if (attachments.length === 0) {
          return 'No attachments found for this email.';
        }

        const list = attachments.map((a, i) => ({
          index: i + 1,
          id: a.id,
          filename: a.originalName,
          type: a.mimeType,
          size: `${(a.size / 1024).toFixed(2)} KB`,
        }));

        return JSON.stringify(list, null, 2);
      }
    );
  }

  protected buildSystemPrompt(context: AgentContext): string {
    return prompts.intake.system({
      companyName: 'Oldcastle BuildingEnvelope',
      supportedProducts: [
        'Curtain Wall Systems',
        'Storefront Systems',
        'Window Systems',
        'Entrance Systems',
        'Skylights',
        'Glass Products',
      ],
      currentDate: new Date().toISOString().split('T')[0],
    });
  }

  protected buildUserPrompt(context: AgentContext): string {
    return prompts.intake.user({
      senderEmail: context.input.senderEmail,
      receivedAt: context.input.receivedAt,
      emailBody: context.input.emailBody,
      attachments: context.input.attachments,
    });
  }

  protected async parseOutput(
    response: string,
    context: AgentContext
  ): Promise<{ state: Partial<RfqState>; output: IntakeOutput }> {
    const parsed = this.extractJsonFromResponse(response);
    const validated = IntakeOutputSchema.parse(parsed);

    return {
      state: {
        parsedData: {
          customerName: validated.customerName ?? undefined,
          projectName: validated.projectName ?? undefined,
          projectReference: validated.projectReference ?? undefined,
          requestedProducts: validated.requestedProducts.map((p) => ({
            name: p.name,
            quantity: p.quantity ?? undefined,
            unit: p.unit ?? undefined,
            specifications: (p.specifications as Record<string, unknown>) ?? undefined,
            drawings: p.drawings ?? undefined,
          })),
          timeline: validated.timeline ?? undefined,
          specialRequirements: validated.specialRequirements ?? undefined,
        },
      },
      output: validated,
    };
  }

  protected determineNextAction(
    parsedOutput: { state: Partial<RfqState>; output: IntakeOutput },
    context: AgentContext
  ): NextAction {
    const { output } = parsedOutput;

    // If confidence is too low, require human intervention
    if (output.confidence < 0.7) {
      return this.requireHumanIntervention(
        'Low confidence in RFQ parsing - please review extracted data',
        output.uncertainFields ?? undefined
      );
    }

    // If no products identified, require human intervention
    if (!output.requestedProducts || output.requestedProducts.length === 0) {
      return this.requireHumanIntervention('Could not identify any products in the RFQ', [
        'requestedProducts',
      ]);
    }

    // Continue to next agent
    return this.continueToNextAgent();
  }
}

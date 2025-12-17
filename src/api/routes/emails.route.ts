import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { emailService, AttachmentInput } from '../../core/email/email.service.js';
import { AppError } from '../../shared/utils/errors.js';

// Request schemas
const ListEmailsQuerySchema = z.object({
  senderEmail: z.string().email().optional(),
  limit: z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
  orderBy: z.enum(['createdAt', 'receivedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const GetEmailParamsSchema = z.object({
  emailId: z.string().uuid(),
});

const GetAttachmentParamsSchema = z.object({
  emailId: z.string().uuid(),
  attachmentId: z.string().uuid(),
});

export async function emailRoutes(fastify: FastifyInstance) {
  // Upload a new email with attachments (multipart form-data)
  fastify.post(
    '/emails',
    {
      schema: {
        tags: ['Emails'],
        summary: 'Upload email with attachments',
        description: `
Upload an RFQ email with optional attachments using multipart form-data.

**Request format:**
- \`email\` field: JSON string with email data
- \`attachments\` field(s): Binary file data (can include multiple files)

**Example using curl:**
\`\`\`bash
curl -X POST http://localhost:3000/api/v1/emails \\
  -F 'email={"subject":"RFQ for Project","body":"Please provide quote...","senderEmail":"customer@example.com"}' \\
  -F 'attachments=@specs.pdf' \\
  -F 'attachments=@drawings.dwg'
\`\`\`
        `,
        consumes: ['multipart/form-data'],
        response: {
          201: {
            description: 'Email uploaded successfully',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              emailId: { type: 'string', format: 'uuid' },
              attachmentCount: { type: 'integer' },
            },
          },
          400: {
            description: 'Validation error',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              code: { type: 'string' },
            },
          },
        },
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parts = request.parts();

      let emailData: {
        subject?: string;
        body?: string;
        senderEmail?: string;
        receivedAt?: string;
        metadata?: Record<string, unknown>;
      } = {};

      const attachments: AttachmentInput[] = [];

      for await (const part of parts) {
        if (part.type === 'file') {
          // Handle file upload
          const chunks: Buffer[] = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
          }
          const buffer = Buffer.concat(chunks);

          attachments.push({
            filename: part.filename,
            originalName: part.filename,
            mimeType: part.mimetype,
            size: buffer.length,
            data: buffer,
          });
        } else {
          // Handle form fields
          const value = part.value as string;
          if (part.fieldname === 'email') {
            try {
              emailData = JSON.parse(value);
            } catch {
              throw new AppError('Invalid JSON in email field', 400, 'VALIDATION_ERROR');
            }
          }
        }
      }

      // Validate email data
      if (!emailData.body) {
        throw new AppError('Email body is required', 400, 'VALIDATION_ERROR');
      }
      if (!emailData.senderEmail) {
        throw new AppError('Sender email is required', 400, 'VALIDATION_ERROR');
      }

      const emailId = await emailService.create(
        {
          subject: emailData.subject,
          body: emailData.body,
          senderEmail: emailData.senderEmail,
          receivedAt: emailData.receivedAt
            ? new Date(emailData.receivedAt)
            : new Date(),
          metadata: emailData.metadata,
        },
        attachments
      );

      return reply.status(201).send({
        success: true,
        emailId,
        attachmentCount: attachments.length,
      });
    }
  );

  // List emails
  fastify.get(
    '/emails',
    {
      schema: {
        tags: ['Emails'],
        summary: 'List emails',
        description: 'Get a paginated list of uploaded emails',
        querystring: {
          type: 'object',
          properties: {
            senderEmail: { type: 'string', format: 'email', description: 'Filter by sender email' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20, description: 'Number of results' },
            offset: { type: 'integer', minimum: 0, default: 0, description: 'Offset for pagination' },
            orderBy: { type: 'string', enum: ['createdAt', 'receivedAt'], default: 'createdAt' },
            order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
          },
        },
        response: {
          200: {
            description: 'List of emails',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              emails: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', format: 'uuid' },
                    subject: { type: 'string', nullable: true },
                    senderEmail: { type: 'string' },
                    receivedAt: { type: 'string', format: 'date-time' },
                    createdAt: { type: 'string', format: 'date-time' },
                    _count: {
                      type: 'object',
                      properties: {
                        attachments: { type: 'integer' },
                        executions: { type: 'integer' },
                      },
                    },
                  },
                },
              },
              total: { type: 'integer' },
              limit: { type: 'integer' },
              offset: { type: 'integer' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Querystring: z.infer<typeof ListEmailsQuerySchema> }>,
      reply: FastifyReply
    ) => {
      const query = ListEmailsQuerySchema.parse(request.query);
      const result = await emailService.list(query);

      return reply.send({
        success: true,
        ...result,
      });
    }
  );

  // Get email by ID
  fastify.get(
    '/emails/:emailId',
    {
      schema: {
        tags: ['Emails'],
        summary: 'Get email by ID',
        description: 'Get email details including attachments metadata',
        params: {
          type: 'object',
          required: ['emailId'],
          properties: {
            emailId: { type: 'string', format: 'uuid', description: 'Email ID' },
          },
        },
        response: {
          200: {
            description: 'Email details',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              email: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  subject: { type: 'string', nullable: true },
                  body: { type: 'string' },
                  senderEmail: { type: 'string' },
                  receivedAt: { type: 'string', format: 'date-time' },
                  metadata: { type: 'object' },
                  createdAt: { type: 'string', format: 'date-time' },
                  updatedAt: { type: 'string', format: 'date-time' },
                  attachments: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        filename: { type: 'string' },
                        originalName: { type: 'string' },
                        mimeType: { type: 'string' },
                        size: { type: 'integer' },
                        createdAt: { type: 'string', format: 'date-time' },
                      },
                    },
                  },
                },
              },
            },
          },
          404: {
            description: 'Email not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: z.infer<typeof GetEmailParamsSchema> }>,
      reply: FastifyReply
    ) => {
      const { emailId } = GetEmailParamsSchema.parse(request.params);
      const email = await emailService.getById(emailId);

      return reply.send({
        success: true,
        email,
      });
    }
  );

  // Get email with all executions
  fastify.get(
    '/emails/:emailId/executions',
    {
      schema: {
        tags: ['Emails'],
        summary: 'Get email with executions',
        description: 'Get email details including all associated executions',
        params: {
          type: 'object',
          required: ['emailId'],
          properties: {
            emailId: { type: 'string', format: 'uuid', description: 'Email ID' },
          },
        },
        response: {
          200: {
            description: 'Email with executions',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              email: {
                type: 'object',
                properties: {
                  id: { type: 'string', format: 'uuid' },
                  subject: { type: 'string', nullable: true },
                  body: { type: 'string' },
                  senderEmail: { type: 'string' },
                  receivedAt: { type: 'string', format: 'date-time' },
                  executions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string', format: 'uuid' },
                        status: { type: 'string' },
                        currentAgent: { type: 'string', nullable: true },
                        createdAt: { type: 'string', format: 'date-time' },
                        completedAt: { type: 'string', format: 'date-time', nullable: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: z.infer<typeof GetEmailParamsSchema> }>,
      reply: FastifyReply
    ) => {
      const { emailId } = GetEmailParamsSchema.parse(request.params);
      const email = await emailService.getWithExecutions(emailId);

      return reply.send({
        success: true,
        email,
      });
    }
  );

  // Download attachment
  fastify.get(
    '/emails/:emailId/attachments/:attachmentId',
    {
      schema: {
        tags: ['Emails'],
        summary: 'Download attachment',
        description: 'Download an email attachment by ID',
        params: {
          type: 'object',
          required: ['emailId', 'attachmentId'],
          properties: {
            emailId: { type: 'string', format: 'uuid', description: 'Email ID' },
            attachmentId: { type: 'string', format: 'uuid', description: 'Attachment ID' },
          },
        },
        response: {
          200: {
            description: 'Attachment file',
            type: 'string',
            format: 'binary',
          },
          404: {
            description: 'Attachment not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: z.infer<typeof GetAttachmentParamsSchema> }>,
      reply: FastifyReply
    ) => {
      const { attachmentId } = GetAttachmentParamsSchema.parse(request.params);
      const { buffer, metadata } = await emailService.getAttachmentContent(attachmentId);

      return reply
        .header('Content-Type', metadata.mimeType)
        .header(
          'Content-Disposition',
          `attachment; filename="${metadata.filename}"`
        )
        .send(buffer);
    }
  );

  // Get presigned URL for attachment
  fastify.get(
    '/emails/:emailId/attachments/:attachmentId/url',
    {
      schema: {
        tags: ['Emails'],
        summary: 'Get presigned URL for attachment',
        description: 'Generate a presigned URL for direct attachment download',
        params: {
          type: 'object',
          required: ['emailId', 'attachmentId'],
          properties: {
            emailId: { type: 'string', format: 'uuid', description: 'Email ID' },
            attachmentId: { type: 'string', format: 'uuid', description: 'Attachment ID' },
          },
        },
        querystring: {
          type: 'object',
          properties: {
            expirySeconds: { type: 'integer', default: 3600, description: 'URL expiry in seconds' },
          },
        },
        response: {
          200: {
            description: 'Presigned URL',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              url: { type: 'string', format: 'uri' },
              expiresIn: { type: 'integer' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Params: z.infer<typeof GetAttachmentParamsSchema>;
        Querystring: { expirySeconds?: string };
      }>,
      reply: FastifyReply
    ) => {
      const { attachmentId } = GetAttachmentParamsSchema.parse(request.params);
      const expirySeconds = request.query.expirySeconds
        ? parseInt(request.query.expirySeconds)
        : 3600;

      const url = await emailService.getAttachmentUrl(attachmentId, expirySeconds);

      return reply.send({
        success: true,
        url,
        expiresIn: expirySeconds,
      });
    }
  );

  // Delete email
  fastify.delete(
    '/emails/:emailId',
    {
      schema: {
        tags: ['Emails'],
        summary: 'Delete email',
        description: 'Delete an email and all associated attachments',
        params: {
          type: 'object',
          required: ['emailId'],
          properties: {
            emailId: { type: 'string', format: 'uuid', description: 'Email ID' },
          },
        },
        response: {
          200: {
            description: 'Email deleted',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
          404: {
            description: 'Email not found',
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{ Params: z.infer<typeof GetEmailParamsSchema> }>,
      reply: FastifyReply
    ) => {
      const { emailId } = GetEmailParamsSchema.parse(request.params);
      await emailService.delete(emailId);

      return reply.send({
        success: true,
        message: 'Email deleted',
      });
    }
  );
}

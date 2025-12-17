import { prisma } from '../../db/client.js';
import { minioService, UploadResult } from '../storage/minio.service.js';
import { logger } from '../../shared/utils/logger.js';
import { NotFoundError } from '../../shared/utils/errors.js';
import { AttachmentInfo } from '../../shared/types/rfq.types.js';

export interface CreateEmailInput {
  subject?: string;
  body: string;
  senderEmail: string;
  receivedAt: Date;
  metadata?: Record<string, unknown>;
}

export interface AttachmentInput {
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  data: Buffer;
}

export interface EmailWithAttachments {
  id: string;
  subject: string | null;
  body: string;
  senderEmail: string;
  receivedAt: Date;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  attachments: AttachmentInfo[];
}

export class EmailService {
  /**
   * Create a new email with attachments
   */
  async create(
    input: CreateEmailInput,
    attachments: AttachmentInput[] = []
  ): Promise<string> {
    // Create email record
    const email = await prisma.email.create({
      data: {
        subject: input.subject,
        body: input.body,
        senderEmail: input.senderEmail,
        receivedAt: input.receivedAt,
        metadata: (input.metadata || {}) as object,
      },
    });

    // Upload attachments to MinIO and create records
    if (attachments.length > 0) {
      const attachmentRecords = await Promise.all(
        attachments.map(async (attachment) => {
          const uploadResult = await minioService.uploadFile(
            attachment.data,
            {
              filename: attachment.filename,
              mimeType: attachment.mimeType,
              size: attachment.size,
            },
            email.id
          );

          return {
            emailId: email.id,
            filename: attachment.filename,
            originalName: attachment.originalName,
            mimeType: attachment.mimeType,
            size: attachment.size,
            bucketName: uploadResult.bucketName,
            objectKey: uploadResult.objectKey,
          };
        })
      );

      await prisma.emailAttachment.createMany({
        data: attachmentRecords,
      });

      logger.info(
        { emailId: email.id, attachmentCount: attachments.length },
        'Email attachments uploaded'
      );
    }

    logger.info({ emailId: email.id }, 'Email created');

    return email.id;
  }

  /**
   * Get email by ID with attachments
   */
  async getById(emailId: string): Promise<EmailWithAttachments> {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: {
        attachments: true,
      },
    });

    if (!email) {
      throw new NotFoundError('Email', emailId);
    }

    return {
      id: email.id,
      subject: email.subject,
      body: email.body,
      senderEmail: email.senderEmail,
      receivedAt: email.receivedAt,
      metadata: email.metadata as Record<string, unknown>,
      createdAt: email.createdAt,
      updatedAt: email.updatedAt,
      attachments: email.attachments.map((a) => ({
        id: a.id,
        filename: a.filename,
        originalName: a.originalName,
        mimeType: a.mimeType,
        size: a.size,
        bucketName: a.bucketName,
        objectKey: a.objectKey,
      })),
    };
  }

  /**
   * Get attachment content as buffer
   */
  async getAttachmentContent(attachmentId: string): Promise<{
    buffer: Buffer;
    metadata: {
      filename: string;
      mimeType: string;
      size: number;
    };
  }> {
    const attachment = await prisma.emailAttachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      throw new NotFoundError('Attachment', attachmentId);
    }

    const buffer = await minioService.downloadFileAsBuffer(attachment.objectKey);

    return {
      buffer,
      metadata: {
        filename: attachment.originalName,
        mimeType: attachment.mimeType,
        size: attachment.size,
      },
    };
  }

  /**
   * Get presigned URL for attachment download
   */
  async getAttachmentUrl(
    attachmentId: string,
    expirySeconds: number = 3600
  ): Promise<string> {
    const attachment = await prisma.emailAttachment.findUnique({
      where: { id: attachmentId },
    });

    if (!attachment) {
      throw new NotFoundError('Attachment', attachmentId);
    }

    return minioService.getPresignedUrl(attachment.objectKey, expirySeconds);
  }

  /**
   * List emails with pagination
   */
  async list(options: {
    senderEmail?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'createdAt' | 'receivedAt';
    order?: 'asc' | 'desc';
  }) {
    const {
      senderEmail,
      limit = 20,
      offset = 0,
      orderBy = 'createdAt',
      order = 'desc',
    } = options;

    const where: { senderEmail?: string } = {};
    if (senderEmail) where.senderEmail = senderEmail;

    const [emails, total] = await Promise.all([
      prisma.email.findMany({
        where,
        include: {
          attachments: {
            select: {
              id: true,
              filename: true,
              mimeType: true,
              size: true,
            },
          },
          _count: {
            select: {
              executions: true,
            },
          },
        },
        orderBy: { [orderBy]: order },
        take: limit,
        skip: offset,
      }),
      prisma.email.count({ where }),
    ]);

    return {
      emails: emails.map((email) => ({
        id: email.id,
        subject: email.subject,
        senderEmail: email.senderEmail,
        receivedAt: email.receivedAt,
        createdAt: email.createdAt,
        attachmentCount: email.attachments.length,
        executionCount: email._count.executions,
        attachments: email.attachments,
      })),
      total,
      limit,
      offset,
    };
  }

  /**
   * Delete an email and its attachments
   */
  async delete(emailId: string): Promise<void> {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: {
        attachments: true,
        executions: {
          select: { id: true, status: true },
        },
      },
    });

    if (!email) {
      throw new NotFoundError('Email', emailId);
    }

    // Check if any executions are in progress
    const activeExecutions = email.executions.filter(
      (e) => e.status === 'PROCESSING' || e.status === 'PENDING'
    );
    if (activeExecutions.length > 0) {
      throw new Error('Cannot delete email with active executions');
    }

    // Delete attachments from MinIO
    if (email.attachments.length > 0) {
      const objectKeys = email.attachments.map((a) => a.objectKey);
      await minioService.deleteFiles(objectKeys);
    }

    // Delete email (cascades to attachments and executions)
    await prisma.email.delete({
      where: { id: emailId },
    });

    logger.info({ emailId }, 'Email deleted');
  }

  /**
   * Get email with all executions
   */
  async getWithExecutions(emailId: string) {
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      include: {
        attachments: true,
        executions: {
          include: {
            agentTasks: {
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!email) {
      throw new NotFoundError('Email', emailId);
    }

    return email;
  }
}

export const emailService = new EmailService();

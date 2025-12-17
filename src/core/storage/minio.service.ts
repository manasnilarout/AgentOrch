import { Client as MinioClient } from 'minio';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../../config/index.js';
import { logger } from '../../shared/utils/logger.js';
import { StorageError } from '../../shared/utils/errors.js';

export interface UploadResult {
  bucketName: string;
  objectKey: string;
  etag: string;
  size: number;
}

export interface FileMetadata {
  filename: string;
  mimeType: string;
  size: number;
}

class MinioService {
  private client: MinioClient;
  private bucket: string;

  constructor() {
    this.client = new MinioClient({
      endPoint: config.minio.endpoint,
      port: config.minio.port,
      useSSL: config.minio.useSSL,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
    });
    this.bucket = config.minio.bucket;
  }

  /**
   * Initialize the bucket if it doesn't exist
   */
  async initialize(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        logger.info({ bucket: this.bucket }, 'MinIO bucket created');
      }
      logger.info({ bucket: this.bucket }, 'MinIO service initialized');
    } catch (error) {
      logger.error({ error, bucket: this.bucket }, 'Failed to initialize MinIO');
      throw new StorageError(`Failed to initialize MinIO: ${error}`);
    }
  }

  /**
   * Upload a file to MinIO
   */
  async uploadFile(
    fileData: Buffer | Readable,
    metadata: FileMetadata,
    emailId: string
  ): Promise<UploadResult> {
    const objectKey = this.generateObjectKey(emailId, metadata.filename);

    try {
      const metaData = {
        'Content-Type': metadata.mimeType,
        'X-Original-Filename': metadata.filename,
        'X-Email-Id': emailId,
      };

      const result = await this.client.putObject(
        this.bucket,
        objectKey,
        fileData,
        metadata.size,
        metaData
      );

      logger.info(
        { bucket: this.bucket, objectKey, size: metadata.size },
        'File uploaded to MinIO'
      );

      return {
        bucketName: this.bucket,
        objectKey,
        etag: result.etag,
        size: metadata.size,
      };
    } catch (error) {
      logger.error({ error, objectKey }, 'Failed to upload file to MinIO');
      throw new StorageError(`Failed to upload file: ${error}`);
    }
  }

  /**
   * Download a file from MinIO
   */
  async downloadFile(objectKey: string): Promise<Readable> {
    try {
      const stream = await this.client.getObject(this.bucket, objectKey);
      return stream;
    } catch (error) {
      logger.error({ error, objectKey }, 'Failed to download file from MinIO');
      throw new StorageError(`Failed to download file: ${error}`);
    }
  }

  /**
   * Download a file as a buffer
   */
  async downloadFileAsBuffer(objectKey: string): Promise<Buffer> {
    const stream = await this.downloadFile(objectKey);
    const chunks: Buffer[] = [];

    return new Promise((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
    });
  }

  /**
   * Get file metadata/stat
   */
  async getFileStat(objectKey: string): Promise<{
    size: number;
    lastModified: Date;
    etag: string;
    metaData: Record<string, string>;
  }> {
    try {
      const stat = await this.client.statObject(this.bucket, objectKey);
      return {
        size: stat.size,
        lastModified: stat.lastModified,
        etag: stat.etag,
        metaData: stat.metaData,
      };
    } catch (error) {
      logger.error({ error, objectKey }, 'Failed to get file stat from MinIO');
      throw new StorageError(`Failed to get file stat: ${error}`);
    }
  }

  /**
   * Delete a file from MinIO
   */
  async deleteFile(objectKey: string): Promise<void> {
    try {
      await this.client.removeObject(this.bucket, objectKey);
      logger.info({ bucket: this.bucket, objectKey }, 'File deleted from MinIO');
    } catch (error) {
      logger.error({ error, objectKey }, 'Failed to delete file from MinIO');
      throw new StorageError(`Failed to delete file: ${error}`);
    }
  }

  /**
   * Delete multiple files
   */
  async deleteFiles(objectKeys: string[]): Promise<void> {
    try {
      await this.client.removeObjects(this.bucket, objectKeys);
      logger.info(
        { bucket: this.bucket, count: objectKeys.length },
        'Files deleted from MinIO'
      );
    } catch (error) {
      logger.error({ error }, 'Failed to delete files from MinIO');
      throw new StorageError(`Failed to delete files: ${error}`);
    }
  }

  /**
   * Get a presigned URL for downloading a file
   */
  async getPresignedUrl(objectKey: string, expirySeconds: number = 3600): Promise<string> {
    try {
      return await this.client.presignedGetObject(this.bucket, objectKey, expirySeconds);
    } catch (error) {
      logger.error({ error, objectKey }, 'Failed to generate presigned URL');
      throw new StorageError(`Failed to generate presigned URL: ${error}`);
    }
  }

  /**
   * List all files for a specific email
   */
  async listFilesForEmail(emailId: string): Promise<string[]> {
    const prefix = `emails/${emailId}/`;
    const objects: string[] = [];

    const stream = this.client.listObjects(this.bucket, prefix, true);

    return new Promise((resolve, reject) => {
      stream.on('data', (obj) => {
        if (obj.name) {
          objects.push(obj.name);
        }
      });
      stream.on('end', () => resolve(objects));
      stream.on('error', reject);
    });
  }

  /**
   * Generate a unique object key for the file
   */
  private generateObjectKey(emailId: string, filename: string): string {
    const sanitizedFilename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uniqueId = uuidv4().slice(0, 8);
    return `emails/${emailId}/${uniqueId}-${sanitizedFilename}`;
  }

  /**
   * Check if the service is healthy
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.bucketExists(this.bucket);
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const minioService = new MinioService();

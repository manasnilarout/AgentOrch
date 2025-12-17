import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const ConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.coerce.number().default(3000),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),

  database: z.object({
    url: z.string().url(),
  }),

  redis: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
  }),

  minio: z.object({
    endpoint: z.string().default('localhost'),
    port: z.coerce.number().default(9000),
    accessKey: z.string().min(1),
    secretKey: z.string().min(1),
    bucket: z.string().default('rfq-attachments'),
    useSSL: z
      .string()
      .transform((val) => val === 'true')
      .default('false'),
  }),

  anthropic: z.object({
    apiKey: z.string().min(1),
  }),

  agent: z.object({
    maxTurns: z.coerce.number().default(15),
    concurrency: z.coerce.number().default(5),
  }),

  queue: z.object({
    jobAttempts: z.coerce.number().default(3),
    backoffDelay: z.coerce.number().default(1000),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

function loadConfig(): Config {
  const result = ConfigSchema.safeParse({
    nodeEnv: process.env.NODE_ENV,
    port: process.env.PORT,
    logLevel: process.env.LOG_LEVEL,

    database: {
      url: process.env.DATABASE_URL,
    },

    redis: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
      password: process.env.REDIS_PASSWORD || undefined,
    },

    minio: {
      endpoint: process.env.MINIO_ENDPOINT,
      port: process.env.MINIO_PORT,
      accessKey: process.env.MINIO_ACCESS_KEY,
      secretKey: process.env.MINIO_SECRET_KEY,
      bucket: process.env.MINIO_BUCKET,
      useSSL: process.env.MINIO_USE_SSL,
    },

    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
    },

    agent: {
      maxTurns: process.env.AGENT_MAX_TURNS,
      concurrency: process.env.AGENT_CONCURRENCY,
    },

    queue: {
      jobAttempts: process.env.QUEUE_JOB_ATTEMPTS,
      backoffDelay: process.env.QUEUE_BACKOFF_DELAY,
    },
  });

  if (!result.success) {
    console.error('Configuration validation failed:');
    console.error(result.error.format());
    throw new Error('Invalid configuration');
  }

  return result.data;
}

export const config = loadConfig();

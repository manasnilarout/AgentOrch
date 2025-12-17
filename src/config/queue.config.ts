import { ConnectionOptions } from 'bullmq';
import { config } from './index.js';

export const redisConnection: ConnectionOptions = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password || undefined,
};

import Redis, { RedisOptions } from 'ioredis';

const redisUrl = process.env.REDIS_URL;
const baseOptions: any = {
  lazyConnect: true,
  maxRetriesPerRequest: 20,
  enableReadyCheck: true,
};

const redis = redisUrl
  ? new Redis(redisUrl, baseOptions)
  : new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    ...baseOptions,
  } as any);

redis.on('connect', () => {
  if (process.env.NODE_ENV !== 'production') {
    console.info('✅ Redis connection established');
  }
});

redis.on('error', (error) => {
  console.error('❌ Redis connection error', error);
});

export const connectRedis = async () => {
  try {
    await redis.connect();
  } catch (error) {
    console.error('❌ Failed to connect to Redis', error);
    process.exit(1);
  }
};

export const disconnectRedis = async () => {
  try {
    await redis.quit();
  } catch (error) {
    console.error('⚠️ Error while disconnecting Redis', error);
  }
};

export default redis;


import Redis, { RedisOptions } from 'ioredis';

// Redis is off unless REDIS_ENABLED=true. When off, every command rejects immediately
// (callers already treat that as a cache miss) and the job queues send inline.
export const REDIS_ENABLED = process.env.REDIS_ENABLED === 'true';

const redisUrl = process.env.REDIS_URL;
const baseOptions: any = {
  lazyConnect: true,
  maxRetriesPerRequest: 20,
  enableReadyCheck: true,
};

const disabledRedis = new Proxy({}, {
  get: (_target, prop) =>
    prop === 'then' ? undefined : () => Promise.reject(new Error('Redis is disabled')),
}) as unknown as Redis;

const redis = !REDIS_ENABLED
  ? disabledRedis
  : redisUrl
  ? new Redis(redisUrl, baseOptions)
  : new Redis({
    host: process.env.REDIS_HOST ?? '127.0.0.1',
    port: Number.parseInt(process.env.REDIS_PORT ?? '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    tls: process.env.REDIS_TLS === 'true' ? {} : undefined,
    ...baseOptions,
  } as any);

if (REDIS_ENABLED) {
  redis.on('connect', () => {
    if (process.env.NODE_ENV !== 'production') {
      console.info('✅ Redis connection established');
    }
  });

  redis.on('error', (error) => {
    console.error('❌ Redis connection error', error);
  });
}

export const connectRedis = async () => {
  if (!REDIS_ENABLED) {
    console.warn('⚠️  Redis disabled (REDIS_ENABLED != true) — caching off, emails/SMS sent inline');
    return;
  }
  try {
    await redis.connect();
  } catch (error) {
    // Redis is optional — caching and email queue degrade gracefully without it
    console.warn('⚠️  Redis unavailable — caching and email queue disabled:', (error as Error).message);
  }
};

export const disconnectRedis = async () => {
  if (!REDIS_ENABLED) return;
  try {
    await redis.quit();
  } catch (error) {
    console.error('⚠️ Error while disconnecting Redis', error);
  }
};

export default redis;


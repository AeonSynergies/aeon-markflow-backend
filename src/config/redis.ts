import IORedis from 'ioredis';
import { requireEnv } from '../utils/requireEnv';

let connection: IORedis | undefined;

/**
 * Shared ioredis connection for BullMQ. maxRetriesPerRequest must be null — BullMQ manages
 * retries itself and throws at construction time otherwise.
 */
export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(requireEnv('REDIS_URL'), { maxRetriesPerRequest: null });
  }
  return connection;
}

/** Test-only: clears the cached connection so a changed env var takes effect. */
export function resetRedisConnectionCache(): void {
  connection = undefined;
}

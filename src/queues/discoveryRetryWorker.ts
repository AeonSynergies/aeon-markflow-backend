import { Worker } from 'bullmq';
import { getRedisConnection } from '../config/redis';
import { graduateStaleDiscoveryRetryLeads } from '../services/leadRecycle.service';
import { DISCOVERY_RETRY_QUEUE_NAME } from './discoveryRetryQueue';

/** Starts the BullMQ worker that runs the daily DISCOVERY_RETRY-graduation sweep. */
export function startDiscoveryRetryWorker(): Worker {
  return new Worker(
    DISCOVERY_RETRY_QUEUE_NAME,
    async () => {
      await graduateStaleDiscoveryRetryLeads();
    },
    { connection: getRedisConnection() },
  );
}

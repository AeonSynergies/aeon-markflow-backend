import { Worker } from 'bullmq';
import { getRedisConnection } from '../config/redis';
import { runSendTimeOptimization } from '../services/sendTimeOptimization.service';
import { SEND_TIME_PERFORMANCE_QUEUE_NAME } from './sendTimePerformanceQueue';

/** Starts the BullMQ worker that actually runs the scheduled rollup + recommendation cycle. */
export function startSendTimePerformanceWorker(): Worker {
  return new Worker(
    SEND_TIME_PERFORMANCE_QUEUE_NAME,
    async () => {
      await runSendTimeOptimization();
    },
    { connection: getRedisConnection() },
  );
}

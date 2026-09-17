import { Worker } from 'bullmq';
import { getRedisConnection } from '../config/redis';
import { runEmailPerformanceAnalysis } from '../services/emailOptimization.service';
import { EMAIL_ANALYTICS_QUEUE_NAME } from './emailAnalyticsQueue';

/** Starts the BullMQ worker that actually runs the scheduled diagnosis-by-symptom job. */
export function startEmailAnalyticsWorker(): Worker {
  return new Worker(
    EMAIL_ANALYTICS_QUEUE_NAME,
    async () => {
      await runEmailPerformanceAnalysis();
    },
    { connection: getRedisConnection() },
  );
}

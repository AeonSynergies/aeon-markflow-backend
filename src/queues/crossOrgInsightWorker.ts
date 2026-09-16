import { Worker } from 'bullmq';
import { getRedisConnection } from '../config/redis';
import { computeCrossOrgInsights } from '../services/crossOrgInsight.service';
import { CROSS_ORG_INSIGHT_QUEUE_NAME } from './crossOrgInsightQueue';

/** Starts the BullMQ worker that actually runs the scheduled cross-org rollup. */
export function startCrossOrgInsightWorker(): Worker {
  return new Worker(
    CROSS_ORG_INSIGHT_QUEUE_NAME,
    async () => {
      await computeCrossOrgInsights();
    },
    { connection: getRedisConnection() },
  );
}

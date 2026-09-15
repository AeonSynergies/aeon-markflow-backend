import { Queue } from 'bullmq';
import { CROSS_ORG_INSIGHT_INTERVAL_MS } from '../constants/crossOrgInsight';
import { getRedisConnection } from '../config/redis';

export const CROSS_ORG_INSIGHT_QUEUE_NAME = 'cross-org-insight';
const RUN_INSIGHT_JOB_NAME = 'compute-cross-org-insights';

let queue: Queue | undefined;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(CROSS_ORG_INSIGHT_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Registers the repeatable job driving Phase 8's cross-org rollup. Weekly, not daily — see
 * CROSS_ORG_INSIGHT_INTERVAL_MS's own comment.
 */
export async function scheduleCrossOrgInsightComputation(): Promise<void> {
  await getQueue().upsertJobScheduler(
    RUN_INSIGHT_JOB_NAME,
    { every: CROSS_ORG_INSIGHT_INTERVAL_MS },
    { name: RUN_INSIGHT_JOB_NAME },
  );
}

/** Test-only: clears the cached queue so a changed connection/env takes effect. */
export function resetCrossOrgInsightQueueCache(): void {
  queue = undefined;
}

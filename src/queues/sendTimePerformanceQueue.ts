import { Queue } from 'bullmq';
import { SEND_TIME_ROLLUP_INTERVAL_MS } from '../constants/sendTimeOptimization';
import { getRedisConnection } from '../config/redis';

export const SEND_TIME_PERFORMANCE_QUEUE_NAME = 'send-time-performance';
const RUN_OPTIMIZATION_JOB_NAME = 'run-send-time-optimization';

let queue: Queue | undefined;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(SEND_TIME_PERFORMANCE_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Registers the repeatable job driving Phase 7's rolling rollup + recommendation cycle. Daily,
 * matching Phase 6's analytics cadence — send-time patterns change slower than content
 * performance, but there's no strong reason yet for a different cadence.
 */
export async function scheduleSendTimeOptimization(): Promise<void> {
  await getQueue().upsertJobScheduler(
    RUN_OPTIMIZATION_JOB_NAME,
    { every: SEND_TIME_ROLLUP_INTERVAL_MS },
    { name: RUN_OPTIMIZATION_JOB_NAME },
  );
}

/** Test-only: clears the cached queue so a changed connection/env takes effect. */
export function resetSendTimePerformanceQueueCache(): void {
  queue = undefined;
}

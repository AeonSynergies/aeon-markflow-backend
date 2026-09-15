import { Queue } from 'bullmq';
import { EMAIL_ANALYTICS_POLL_INTERVAL_MS } from '../constants/emailAnalytics';
import { getRedisConnection } from '../config/redis';

export const EMAIL_ANALYTICS_QUEUE_NAME = 'email-analytics';
const RUN_ANALYSIS_JOB_NAME = 'run-email-performance-analysis';

let queue: Queue | undefined;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(EMAIL_ANALYTICS_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Registers the repeatable job driving the diagnosis-by-symptom pipeline. Daily, not the
 * mailbox poller's 5 minutes — content performance doesn't need minute-level reaction, and a
 * slower cadence gives more sends to accumulate between runs.
 */
export async function scheduleEmailPerformanceAnalysis(): Promise<void> {
  await getQueue().upsertJobScheduler(
    RUN_ANALYSIS_JOB_NAME,
    { every: EMAIL_ANALYTICS_POLL_INTERVAL_MS },
    { name: RUN_ANALYSIS_JOB_NAME },
  );
}

/** Test-only: clears the cached queue so a changed connection/env takes effect. */
export function resetEmailAnalyticsQueueCache(): void {
  queue = undefined;
}

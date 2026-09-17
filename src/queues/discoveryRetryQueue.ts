import { Queue } from 'bullmq';
import { getRedisConnection } from '../config/redis';

export const DISCOVERY_RETRY_QUEUE_NAME = 'discovery-retry-graduation';

/** Once daily — DISCOVERY_RETRY_GRADUATION_DAYS (constants/lead.ts) is a 30-day threshold, so
 * there's no value in checking more often than this. */
export const DISCOVERY_RETRY_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

const SWEEP_JOB_NAME = 'graduate-stale-discovery-retry-leads';

let queue: Queue | undefined;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(DISCOVERY_RETRY_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Registers the repeatable job that graduates stale DISCOVERY_RETRY leads to RECLAIMED.
 * upsertJobScheduler keys on SWEEP_JOB_NAME, so calling this again (e.g. on every worker process
 * restart) updates the same scheduler rather than accumulating duplicate repeatable jobs.
 */
export async function scheduleDiscoveryRetryGraduation(): Promise<void> {
  await getQueue().upsertJobScheduler(
    SWEEP_JOB_NAME,
    { every: DISCOVERY_RETRY_SWEEP_INTERVAL_MS },
    { name: SWEEP_JOB_NAME },
  );
}

/** Test-only: clears the cached queue so a changed connection/env takes effect. */
export function resetDiscoveryRetryQueueCache(): void {
  queue = undefined;
}

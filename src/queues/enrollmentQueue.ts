import { Queue } from 'bullmq';
import { getRedisConnection } from '../config/redis';

export const ENROLLMENT_QUEUE_NAME = 'enrollment-steps';

export interface EnrollmentStepJobData {
  enrollmentId: string;
  stepIndex: number;
}

let queue: Queue<EnrollmentStepJobData> | undefined;

function getQueue(): Queue<EnrollmentStepJobData> {
  if (!queue) {
    queue = new Queue<EnrollmentStepJobData>(ENROLLMENT_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Schedules processing of one enrollment step. `delayMs` is how BullMQ implements a workflow
 * "wait" step — the job simply doesn't become runnable until the delay elapses. A stable jobId
 * per (enrollment, step) means re-enqueuing the same step is a no-op rather than a duplicate.
 */
export async function enqueueStepJob(enrollmentId: string, stepIndex: number, delayMs = 0): Promise<void> {
  await getQueue().add(
    'process-step',
    { enrollmentId, stepIndex },
    { jobId: `${enrollmentId}:${stepIndex}`, delay: delayMs },
  );
}

/** Test-only: clears the cached queue so a changed connection/env takes effect. */
export function resetEnrollmentQueueCache(): void {
  queue = undefined;
}

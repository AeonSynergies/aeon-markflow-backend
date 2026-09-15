import { randomUUID } from 'crypto';
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

/**
 * Re-schedules an enrollment's current step after SendGuardrail deferred it (throttled or a
 * paused domain). Uses a fresh, random jobId every call rather than the stable
 * `${enrollmentId}:${step}` one enqueueStepJob uses: BullMQ treats `add()` with a jobId that
 * already exists — even one that already completed — as a no-op, which would otherwise silently
 * swallow the retry. A random suffix (rather than just a timestamp) also avoids two retries
 * enqueued within the same millisecond colliding with each other. The processor re-reads
 * current_step_index from the Enrollment document itself, so it doesn't need stepIndex to be
 * exact — it's carried along only for visibility into what's being retried.
 */
export async function enqueueGuardrailRetryJob(
  enrollmentId: string,
  stepIndex: number,
  delayMs: number,
): Promise<void> {
  await getQueue().add(
    'process-step',
    { enrollmentId, stepIndex },
    { jobId: `${enrollmentId}:${stepIndex}:guardrail-retry:${randomUUID()}`, delay: delayMs },
  );
}

/** Test-only: clears the cached queue so a changed connection/env takes effect. */
export function resetEnrollmentQueueCache(): void {
  queue = undefined;
}

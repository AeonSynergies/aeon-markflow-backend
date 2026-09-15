import { Queue } from 'bullmq';
import { getRedisConnection } from '../config/redis';

export const MAILBOX_POLL_QUEUE_NAME = 'mailbox-poll';

/**
 * How often every configured sending mailbox is polled for bounces/complaints/replies. A
 * proposed default, like SendGuardrail's ramp-up numbers — 5 minutes balances catching a bad
 * domain reasonably quickly against API call volume across every mailbox; adjust once this is
 * running against real mail flow.
 */
export const MAILBOX_POLL_INTERVAL_MS = 5 * 60 * 1000;

const POLL_ALL_JOB_NAME = 'poll-all-mailboxes';

let queue: Queue | undefined;

function getQueue(): Queue {
  if (!queue) {
    queue = new Queue(MAILBOX_POLL_QUEUE_NAME, { connection: getRedisConnection() });
  }
  return queue;
}

/**
 * Registers the repeatable job that drives mailbox polling. upsertJobScheduler keys on
 * POLL_ALL_JOB_NAME, so calling this again (e.g. on every worker process restart) updates the
 * same scheduler rather than accumulating duplicate repeatable jobs.
 */
export async function scheduleMailboxPolling(): Promise<void> {
  await getQueue().upsertJobScheduler(POLL_ALL_JOB_NAME, { every: MAILBOX_POLL_INTERVAL_MS }, { name: POLL_ALL_JOB_NAME });
}

/** Test-only: clears the cached queue so a changed connection/env takes effect. */
export function resetMailboxPollQueueCache(): void {
  queue = undefined;
}

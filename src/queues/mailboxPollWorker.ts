import { Worker } from 'bullmq';
import { getRedisConnection } from '../config/redis';
import { pollAllMailboxes } from '../services/mailboxPoller.service';
import { MAILBOX_POLL_QUEUE_NAME } from './mailboxPollQueue';

/** Starts the BullMQ worker that actually runs the scheduled mailbox-polling job. */
export function startMailboxPollWorker(): Worker {
  return new Worker(
    MAILBOX_POLL_QUEUE_NAME,
    async () => {
      await pollAllMailboxes();
    },
    { connection: getRedisConnection() },
  );
}

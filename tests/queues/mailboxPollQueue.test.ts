const upsertJobSchedulerMock = jest.fn();
const queueConstructor = jest.fn().mockImplementation(() => ({ upsertJobScheduler: upsertJobSchedulerMock }));

jest.mock('bullmq', () => ({ Queue: queueConstructor }));
jest.mock('../../src/config/redis', () => ({ getRedisConnection: jest.fn(() => ({ mockConnection: true })) }));

import {
  MAILBOX_POLL_INTERVAL_MS,
  MAILBOX_POLL_QUEUE_NAME,
  resetMailboxPollQueueCache,
  scheduleMailboxPolling,
} from '../../src/queues/mailboxPollQueue';

describe('mailboxPollQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMailboxPollQueueCache();
  });

  it('constructs the queue once, against the shared redis connection', async () => {
    await scheduleMailboxPolling();
    await scheduleMailboxPolling();

    expect(queueConstructor).toHaveBeenCalledTimes(1);
    expect(queueConstructor).toHaveBeenCalledWith(MAILBOX_POLL_QUEUE_NAME, { connection: { mockConnection: true } });
  });

  it('upserts a job scheduler keyed by a stable id, so re-registering never duplicates it', async () => {
    await scheduleMailboxPolling();

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      'poll-all-mailboxes',
      { every: MAILBOX_POLL_INTERVAL_MS },
      { name: 'poll-all-mailboxes' },
    );
  });
});

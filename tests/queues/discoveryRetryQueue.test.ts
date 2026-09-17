const upsertJobSchedulerMock = jest.fn();
const queueConstructor = jest.fn().mockImplementation(() => ({ upsertJobScheduler: upsertJobSchedulerMock }));

jest.mock('bullmq', () => ({ Queue: queueConstructor }));
jest.mock('../../src/config/redis', () => ({ getRedisConnection: jest.fn(() => ({ mockConnection: true })) }));

import {
  DISCOVERY_RETRY_QUEUE_NAME,
  DISCOVERY_RETRY_SWEEP_INTERVAL_MS,
  resetDiscoveryRetryQueueCache,
  scheduleDiscoveryRetryGraduation,
} from '../../src/queues/discoveryRetryQueue';

describe('discoveryRetryQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDiscoveryRetryQueueCache();
  });

  it('constructs the queue once, against the shared redis connection', async () => {
    await scheduleDiscoveryRetryGraduation();
    await scheduleDiscoveryRetryGraduation();

    expect(queueConstructor).toHaveBeenCalledTimes(1);
    expect(queueConstructor).toHaveBeenCalledWith(DISCOVERY_RETRY_QUEUE_NAME, { connection: { mockConnection: true } });
  });

  it('upserts a daily job scheduler keyed by a stable id, so re-registering never duplicates it', async () => {
    await scheduleDiscoveryRetryGraduation();

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      'graduate-stale-discovery-retry-leads',
      { every: DISCOVERY_RETRY_SWEEP_INTERVAL_MS },
      { name: 'graduate-stale-discovery-retry-leads' },
    );
  });
});

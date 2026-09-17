const upsertJobSchedulerMock = jest.fn();
const queueConstructor = jest.fn().mockImplementation(() => ({ upsertJobScheduler: upsertJobSchedulerMock }));

jest.mock('bullmq', () => ({ Queue: queueConstructor }));
jest.mock('../../src/config/redis', () => ({ getRedisConnection: jest.fn(() => ({ mockConnection: true })) }));

import { CROSS_ORG_INSIGHT_INTERVAL_MS } from '../../src/constants/crossOrgInsight';
import {
  CROSS_ORG_INSIGHT_QUEUE_NAME,
  resetCrossOrgInsightQueueCache,
  scheduleCrossOrgInsightComputation,
} from '../../src/queues/crossOrgInsightQueue';

describe('crossOrgInsightQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetCrossOrgInsightQueueCache();
  });

  it('constructs the queue once, against the shared redis connection', async () => {
    await scheduleCrossOrgInsightComputation();
    await scheduleCrossOrgInsightComputation();

    expect(queueConstructor).toHaveBeenCalledTimes(1);
    expect(queueConstructor).toHaveBeenCalledWith(CROSS_ORG_INSIGHT_QUEUE_NAME, { connection: { mockConnection: true } });
  });

  it('upserts a weekly job scheduler keyed by a stable id, so re-registering never duplicates it', async () => {
    await scheduleCrossOrgInsightComputation();

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      'compute-cross-org-insights',
      { every: CROSS_ORG_INSIGHT_INTERVAL_MS },
      { name: 'compute-cross-org-insights' },
    );
  });
});

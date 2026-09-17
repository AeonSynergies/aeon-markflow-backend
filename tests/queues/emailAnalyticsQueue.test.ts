const upsertJobSchedulerMock = jest.fn();
const queueConstructor = jest.fn().mockImplementation(() => ({ upsertJobScheduler: upsertJobSchedulerMock }));

jest.mock('bullmq', () => ({ Queue: queueConstructor }));
jest.mock('../../src/config/redis', () => ({ getRedisConnection: jest.fn(() => ({ mockConnection: true })) }));

import { EMAIL_ANALYTICS_POLL_INTERVAL_MS } from '../../src/constants/emailAnalytics';
import {
  EMAIL_ANALYTICS_QUEUE_NAME,
  resetEmailAnalyticsQueueCache,
  scheduleEmailPerformanceAnalysis,
} from '../../src/queues/emailAnalyticsQueue';

describe('emailAnalyticsQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetEmailAnalyticsQueueCache();
  });

  it('constructs the queue once, against the shared redis connection', async () => {
    await scheduleEmailPerformanceAnalysis();
    await scheduleEmailPerformanceAnalysis();

    expect(queueConstructor).toHaveBeenCalledTimes(1);
    expect(queueConstructor).toHaveBeenCalledWith(EMAIL_ANALYTICS_QUEUE_NAME, { connection: { mockConnection: true } });
  });

  it('upserts a daily job scheduler keyed by a stable id, so re-registering never duplicates it', async () => {
    await scheduleEmailPerformanceAnalysis();

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      'run-email-performance-analysis',
      { every: EMAIL_ANALYTICS_POLL_INTERVAL_MS },
      { name: 'run-email-performance-analysis' },
    );
  });
});

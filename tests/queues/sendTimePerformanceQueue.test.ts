const upsertJobSchedulerMock = jest.fn();
const queueConstructor = jest.fn().mockImplementation(() => ({ upsertJobScheduler: upsertJobSchedulerMock }));

jest.mock('bullmq', () => ({ Queue: queueConstructor }));
jest.mock('../../src/config/redis', () => ({ getRedisConnection: jest.fn(() => ({ mockConnection: true })) }));

import { SEND_TIME_ROLLUP_INTERVAL_MS } from '../../src/constants/sendTimeOptimization';
import {
  SEND_TIME_PERFORMANCE_QUEUE_NAME,
  resetSendTimePerformanceQueueCache,
  scheduleSendTimeOptimization,
} from '../../src/queues/sendTimePerformanceQueue';

describe('sendTimePerformanceQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSendTimePerformanceQueueCache();
  });

  it('constructs the queue once, against the shared redis connection', async () => {
    await scheduleSendTimeOptimization();
    await scheduleSendTimeOptimization();

    expect(queueConstructor).toHaveBeenCalledTimes(1);
    expect(queueConstructor).toHaveBeenCalledWith(SEND_TIME_PERFORMANCE_QUEUE_NAME, { connection: { mockConnection: true } });
  });

  it('upserts a daily job scheduler keyed by a stable id, so re-registering never duplicates it', async () => {
    await scheduleSendTimeOptimization();

    expect(upsertJobSchedulerMock).toHaveBeenCalledWith(
      'run-send-time-optimization',
      { every: SEND_TIME_ROLLUP_INTERVAL_MS },
      { name: 'run-send-time-optimization' },
    );
  });
});

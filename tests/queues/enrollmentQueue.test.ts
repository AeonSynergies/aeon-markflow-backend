const addMock = jest.fn();
const queueConstructor = jest.fn().mockImplementation(() => ({ add: addMock }));

jest.mock('bullmq', () => ({ Queue: queueConstructor }));
jest.mock('../../src/config/redis', () => ({ getRedisConnection: jest.fn(() => ({ mockConnection: true })) }));

import { enqueueStepJob, ENROLLMENT_QUEUE_NAME, resetEnrollmentQueueCache } from '../../src/queues/enrollmentQueue';

describe('enrollmentQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetEnrollmentQueueCache();
  });

  it('constructs the queue once, against the shared redis connection', async () => {
    await enqueueStepJob('enr-1', 0);
    await enqueueStepJob('enr-1', 1);

    expect(queueConstructor).toHaveBeenCalledTimes(1);
    expect(queueConstructor).toHaveBeenCalledWith(ENROLLMENT_QUEUE_NAME, { connection: { mockConnection: true } });
  });

  it('enqueues a job with a stable per-(enrollment, step) id and the given delay', async () => {
    await enqueueStepJob('enr-1', 2, 5000);

    expect(addMock).toHaveBeenCalledWith(
      'process-step',
      { enrollmentId: 'enr-1', stepIndex: 2 },
      { jobId: 'enr-1:2', delay: 5000 },
    );
  });

  it('defaults delay to 0', async () => {
    await enqueueStepJob('enr-1', 0);
    expect(addMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.objectContaining({ delay: 0 }));
  });
});

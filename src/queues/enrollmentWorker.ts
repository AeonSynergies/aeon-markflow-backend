import { Worker, type Job } from 'bullmq';
import { getRedisConnection } from '../config/redis';
import { ENROLLMENT_QUEUE_NAME, type EnrollmentStepJobData } from './enrollmentQueue';
import { processEnrollmentStepJob } from './enrollmentProcessor';

/** Starts the BullMQ worker that actually executes enrollment steps over time. */
export function startEnrollmentWorker(): Worker<EnrollmentStepJobData> {
  return new Worker<EnrollmentStepJobData>(
    ENROLLMENT_QUEUE_NAME,
    async (job: Job<EnrollmentStepJobData>) => {
      await processEnrollmentStepJob(job.data.enrollmentId);
    },
    { connection: getRedisConnection() },
  );
}

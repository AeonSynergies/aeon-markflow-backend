import { connectDatabase } from './config/database';
import { startHealthCheckServer } from './healthCheckServer';
import { scheduleCrossOrgInsightComputation } from './queues/crossOrgInsightQueue';
import { startCrossOrgInsightWorker } from './queues/crossOrgInsightWorker';
import { scheduleDiscoveryRetryGraduation } from './queues/discoveryRetryQueue';
import { startDiscoveryRetryWorker } from './queues/discoveryRetryWorker';
import { scheduleEmailPerformanceAnalysis } from './queues/emailAnalyticsQueue';
import { startEmailAnalyticsWorker } from './queues/emailAnalyticsWorker';
import { startEnrollmentWorker } from './queues/enrollmentWorker';
import { scheduleMailboxPolling } from './queues/mailboxPollQueue';
import { startMailboxPollWorker } from './queues/mailboxPollWorker';
import { scheduleSendTimeOptimization } from './queues/sendTimePerformanceQueue';
import { startSendTimePerformanceWorker } from './queues/sendTimePerformanceWorker';

async function main(): Promise<void> {
  await connectDatabase();

  // App Runner is request-driven and health-checked — this process otherwise never listens on
  // any port. See src/healthCheckServer.ts's own comment for why this exists.
  startHealthCheckServer();

  const worker = startEnrollmentWorker();
  worker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`Enrollment step job ${job?.id} failed:`, error);
  });

  const mailboxPollWorker = startMailboxPollWorker();
  mailboxPollWorker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`Mailbox poll job ${job?.id} failed:`, error);
  });
  await scheduleMailboxPolling();

  const emailAnalyticsWorker = startEmailAnalyticsWorker();
  emailAnalyticsWorker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`Email analytics job ${job?.id} failed:`, error);
  });
  await scheduleEmailPerformanceAnalysis();

  const sendTimePerformanceWorker = startSendTimePerformanceWorker();
  sendTimePerformanceWorker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`Send-time performance job ${job?.id} failed:`, error);
  });
  await scheduleSendTimeOptimization();

  const crossOrgInsightWorker = startCrossOrgInsightWorker();
  crossOrgInsightWorker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`Cross-org insight job ${job?.id} failed:`, error);
  });
  await scheduleCrossOrgInsightComputation();

  const discoveryRetryWorker = startDiscoveryRetryWorker();
  discoveryRetryWorker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`Discovery-retry graduation job ${job?.id} failed:`, error);
  });
  await scheduleDiscoveryRetryGraduation();

  // eslint-disable-next-line no-console
  console.log('Enrollment worker started');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start enrollment worker:', error);
  process.exit(1);
});

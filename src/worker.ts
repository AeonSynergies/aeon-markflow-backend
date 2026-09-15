import { connectDatabase } from './config/database';
import { scheduleEmailPerformanceAnalysis } from './queues/emailAnalyticsQueue';
import { startEmailAnalyticsWorker } from './queues/emailAnalyticsWorker';
import { startEnrollmentWorker } from './queues/enrollmentWorker';
import { scheduleMailboxPolling } from './queues/mailboxPollQueue';
import { startMailboxPollWorker } from './queues/mailboxPollWorker';

async function main(): Promise<void> {
  await connectDatabase();

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

  // eslint-disable-next-line no-console
  console.log('Enrollment worker started');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start enrollment worker:', error);
  process.exit(1);
});

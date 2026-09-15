import { connectDatabase } from './config/database';
import { startEnrollmentWorker } from './queues/enrollmentWorker';

async function main(): Promise<void> {
  await connectDatabase();

  const worker = startEnrollmentWorker();
  worker.on('failed', (job, error) => {
    // eslint-disable-next-line no-console
    console.error(`Enrollment step job ${job?.id} failed:`, error);
  });

  // eslint-disable-next-line no-console
  console.log('Enrollment worker started');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start enrollment worker:', error);
  process.exit(1);
});

import express, { type Express } from 'express';
import cors from 'cors';
import { trackingRouter } from './routes/tracking.routes';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use(trackingRouter);

  return app;
}

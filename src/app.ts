import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiSpec } from './config/openapi';
import { brandVoiceRouter } from './routes/brandVoice.routes';
import { crossOrgInsightRouter } from './routes/crossOrgInsight.routes';
import { emailTemplateRouter } from './routes/emailTemplate.routes';
import { guardrailSettingsRouter } from './routes/guardrailSettings.routes';
import { leadRouter } from './routes/lead.routes';
import { organizationSettingsRouter } from './routes/organizationSettings.routes';
import { reviewTaskRouter } from './routes/reviewTask.routes';
import { savedListRouter } from './routes/savedList.routes';
import { trackingRouter } from './routes/tracking.routes';
import { userAccessGrantRouter } from './routes/userAccessGrant.routes';
import { workflowTemplateRouter } from './routes/workflowTemplate.routes';
import { statusForError } from './utils/httpErrors';

export function createApp(): Express {
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const openApiSpec = buildOpenApiSpec();
  app.get('/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  app.use(trackingRouter);
  app.use(workflowTemplateRouter);
  app.use(emailTemplateRouter);
  app.use(reviewTaskRouter);
  app.use(crossOrgInsightRouter);
  app.use(leadRouter);
  app.use(savedListRouter);
  app.use(organizationSettingsRouter);
  app.use(userAccessGrantRouter);
  app.use(guardrailSettingsRouter);
  app.use(brandVoiceRouter);

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const status = statusForError(err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    if (status >= 500) {
      // eslint-disable-next-line no-console
      console.error(err);
    }
    res.status(status).json({ error: message });
  });

  return app;
}

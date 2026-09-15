import { Router, type NextFunction, type Request, type Response } from 'express';
import { WORKFLOW_ACCESS_ROLES } from '../constants/workflow';
import type { EmailTemplateVersionStatus } from '../constants/emailTemplate';
import { EMAIL_TEMPLATE_VERSION_STATUSES } from '../constants/emailTemplate';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import { getEmailTemplate, listEmailTemplatesForOrg } from '../services/emailTemplate.service';
import { EmailTemplateNotFoundError, listEmailTemplateVersions } from '../services/emailTemplateVersion.service';
import type { EmailTemplateResponse, EmailTemplateVersionResponse } from '../types/api/emailTemplate';
import type { EmailTemplateDocument } from '../models/EmailTemplate.model';
import type { EmailTemplateVersionDocument } from '../models/EmailTemplateVersion.model';
import { getParam } from '../utils/params';

const getOrgIdParam = (req: Request) => getParam(req, 'orgId');

function toEmailTemplateResponse(template: EmailTemplateDocument): EmailTemplateResponse {
  return JSON.parse(JSON.stringify(template)) as EmailTemplateResponse;
}

function toEmailTemplateVersionResponse(version: EmailTemplateVersionDocument): EmailTemplateVersionResponse {
  return JSON.parse(JSON.stringify(version)) as EmailTemplateVersionResponse;
}

/** Same not-found-not-forbidden masking as workflowTemplate.routes — a guessed id from another
 * org should 404, not confirm the template exists by 403ing instead. */
function assertBelongsToOrg(template: EmailTemplateDocument, orgId: string): void {
  if (template.org_id.toString() !== orgId) {
    throw new EmailTemplateNotFoundError(template._id.toString());
  }
}

function parseStatusQuery(req: Request): EmailTemplateVersionStatus | undefined {
  const raw = req.query.status;
  if (typeof raw !== 'string') return undefined;
  return (EMAIL_TEMPLATE_VERSION_STATUSES as readonly string[]).includes(raw)
    ? (raw as EmailTemplateVersionStatus)
    : undefined;
}

export async function listEmailTemplatesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templates = await listEmailTemplatesForOrg(getParam(req, 'orgId'));
    res.json(templates.map(toEmailTemplateResponse));
  } catch (error) {
    next(error);
  }
}

export async function listEmailTemplateVersionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const templateId = getParam(req, 'templateId');
    const template = await getEmailTemplate(templateId);
    assertBelongsToOrg(template, getParam(req, 'orgId'));

    const versions = await listEmailTemplateVersions(templateId, parseStatusQuery(req));
    res.json(versions.map(toEmailTemplateVersionResponse));
  } catch (error) {
    next(error);
  }
}

export const emailTemplateRouter = Router();

emailTemplateRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /orgs/{orgId}/email-templates:
 *   get:
 *     summary: List email templates for an org
 *     tags: [EmailTemplates]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/EmailTemplateResponse' }
 */
emailTemplateRouter.get(
  '/orgs/:orgId/email-templates',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  listEmailTemplatesHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/email-templates/{templateId}/versions:
 *   get:
 *     summary: List an email template's versions
 *     description: >
 *       Pass status=APPROVED to get the set safe to pin a workflow email step to — a
 *       WorkflowStep pins to a specific EmailTemplateVersion id, never "latest".
 *     tags: [EmailTemplates]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: templateId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [DRAFT, PENDING_APPROVAL, APPROVED, REJECTED, RESUBMITTED]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/EmailTemplateVersionResponse' }
 *       404:
 *         description: Not found
 */
emailTemplateRouter.get(
  '/orgs/:orgId/email-templates/:templateId/versions',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  listEmailTemplateVersionsHandler,
);

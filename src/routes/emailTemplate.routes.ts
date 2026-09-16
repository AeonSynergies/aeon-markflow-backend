import { Router, type NextFunction, type Request, type Response } from 'express';
import { WORKFLOW_ACCESS_ROLES } from '../constants/workflow';
import type { EmailTemplateVersionStatus } from '../constants/emailTemplate';
import { EMAIL_TEMPLATE_VERSION_STATUSES } from '../constants/emailTemplate';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import {
  getEmailTemplate,
  listEmailTemplatesForOrg,
  listEmailTemplateUsages,
  type EmailTemplateUsage,
} from '../services/emailTemplate.service';
import { EmailTemplateNotFoundError, listEmailTemplateVersions } from '../services/emailTemplateVersion.service';
import type {
  EmailTemplateResponse,
  EmailTemplateUsageResponse,
  EmailTemplateVersionResponse,
} from '../types/api/emailTemplate';
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

function toEmailTemplateUsageResponse(usage: EmailTemplateUsage): EmailTemplateUsageResponse {
  return {
    workflow_template_id: usage.workflowTemplateId,
    workflow_template_name: usage.workflowTemplateName,
    workflow_type: usage.workflowType,
    step_index: usage.stepIndex,
    email_template_version_id: usage.emailTemplateVersionId,
    version_number: usage.versionNumber,
  };
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

function parseStringQuery(req: Request, name: string): string | undefined {
  const raw = req.query[name];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

export async function listEmailTemplatesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templates = await listEmailTemplatesForOrg(getParam(req, 'orgId'), {
      persona: parseStringQuery(req, 'persona'),
      workflowPosition: parseStringQuery(req, 'workflow_position'),
      intendedWorkflowType: parseStringQuery(req, 'intended_workflow_type'),
      status: parseStatusQuery(req),
    });
    res.json(templates.map(toEmailTemplateResponse));
  } catch (error) {
    next(error);
  }
}

export async function listEmailTemplateUsagesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templateId = getParam(req, 'templateId');
    const template = await getEmailTemplate(templateId);
    assertBelongsToOrg(template, getParam(req, 'orgId'));

    const usages = await listEmailTemplateUsages(templateId);
    res.json(usages.map(toEmailTemplateUsageResponse));
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
 *     summary: List email templates for an org, optionally filtered by context
 *     description: >
 *       Unfiltered, returns every template in the org (not just those pending approval) — a
 *       browsable listing for a UI to show. Filtered by persona/workflow_position/
 *       intended_workflow_type and status=APPROVED, this is also the workflow builder's own
 *       template-picker query: it narrows candidates for a step's inspector directly to
 *       templates with an approved, pinnable version (current_version_id), instead of listing
 *       every approved template in the org.
 *     tags: [EmailTemplates]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: persona
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: workflow_position
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: intended_workflow_type
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         required: false
 *         description: Only templates with at least one version at this status.
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
 * /orgs/{orgId}/email-templates/{templateId}/usages:
 *   get:
 *     summary: List every WorkflowTemplate step currently pinned to a version of this template
 *     description: >
 *       Computed live from WorkflowTemplate.steps on every call — no separate stored index.
 *       Never includes Enrollment.steps, which are frozen per-enrollment snapshots that can't be
 *       broken by editing or removing this template. Meant to warn a human what would break
 *       before they make a destructive change to a template still in use.
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
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/EmailTemplateUsageResponse' }
 *       404:
 *         description: Not found
 */
emailTemplateRouter.get(
  '/orgs/:orgId/email-templates/:templateId/usages',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  listEmailTemplateUsagesHandler,
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

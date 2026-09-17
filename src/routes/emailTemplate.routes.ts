import { Router, type NextFunction, type Request, type Response } from 'express';
import { WORKFLOW_ACCESS_ROLES } from '../constants/workflow';
import type { EmailTemplateVersionStatus } from '../constants/emailTemplate';
import { EMAIL_TEMPLATE_VERSION_STATUSES, TEMPLATE_APPROVER_ROLES } from '../constants/emailTemplate';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import {
  getEmailTemplate,
  listEmailTemplatesForOrg,
  listEmailTemplateUsages,
  type EmailTemplateUsage,
} from '../services/emailTemplate.service';
import {
  EmailTemplateNotFoundError,
  EmailTemplateVersionNotFoundError,
  approveVersion,
  createAiDraftVersion,
  getEmailTemplateVersion,
  listEmailTemplateVersions,
  rejectVersion,
  resubmitVersion,
  submitForReview,
} from '../services/emailTemplateVersion.service';
import type {
  CreateAiDraftEmailTemplateVersionRequest,
  EmailTemplateResponse,
  EmailTemplateUsageResponse,
  EmailTemplateVersionResponse,
  RejectEmailTemplateVersionRequest,
  ResubmitEmailTemplateVersionRequest,
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

/** Resolves :versionId, verifying it both belongs to :templateId and that :templateId belongs to
 * :orgId — the same not-found-not-forbidden masking as everywhere else: a versionId that exists
 * but doesn't match the URL's templateId (wrong id typed in, or a cross-org guess) 404s exactly
 * like a versionId that doesn't exist at all. */
async function resolveVersionForOrg(
  req: Request,
): Promise<{ template: EmailTemplateDocument; version: EmailTemplateVersionDocument }> {
  const templateId = getParam(req, 'templateId');
  const versionId = getParam(req, 'versionId');

  const template = await getEmailTemplate(templateId);
  assertBelongsToOrg(template, getParam(req, 'orgId'));

  const version = await getEmailTemplateVersion(versionId);
  if (version.email_template_id.toString() !== templateId) {
    throw new EmailTemplateVersionNotFoundError(versionId);
  }

  return { template, version };
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

/**
 * The route-level gate (`requireRole(TEMPLATE_APPROVER_ROLES)`) already guarantees at least one
 * of the caller's roles qualifies — this just picks one to hand to the service layer, which
 * takes a single `Role` (see `approveVersion`/`rejectVersion`'s own signatures, unchanged here
 * rather than widened to accept an array, since every existing caller/test assumes one role).
 */
function pickApproverRole(req: Request) {
  return req.orgAccess!.roles.find((role) => TEMPLATE_APPROVER_ROLES.includes(role))!;
}

export async function approveEmailTemplateVersionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { version } = await resolveVersionForOrg(req);
    const approved = await approveVersion(version._id.toString(), req.user!.id, pickApproverRole(req));
    res.json(toEmailTemplateVersionResponse(approved));
  } catch (error) {
    next(error);
  }
}

export async function rejectEmailTemplateVersionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { version } = await resolveVersionForOrg(req);
    const body = req.body as RejectEmailTemplateVersionRequest;
    if (!body.reason?.trim()) {
      res.status(400).json({ error: 'reason is required' });
      return;
    }

    const rejected = await rejectVersion(version._id.toString(), req.user!.id, pickApproverRole(req), body.reason.trim());
    res.json(toEmailTemplateVersionResponse(rejected));
  } catch (error) {
    next(error);
  }
}

/**
 * Resubmit is one HTTP action covering two service calls (resubmitVersion, then
 * submitForReview) — resubmitVersion alone would leave the version at RESUBMITTED with no fresh
 * OPEN ReviewTask, which isn't actionable by anyone. There's still no standalone HTTP route for
 * submitForReview's *other* caller — the original DRAFT → PENDING_APPROVAL submission, including
 * for a version this same file's createAiDraftEmailTemplateVersionHandler just created — see that
 * handler's own doc comment.
 */
export async function resubmitEmailTemplateVersionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { version } = await resolveVersionForOrg(req);
    const body = req.body as ResubmitEmailTemplateVersionRequest;

    await resubmitVersion(version._id.toString(), { subjectLine: body.subject_line, bodyHtml: body.body_html });
    const resubmitted = await submitForReview(version._id.toString(), req.user?.id);
    res.json(toEmailTemplateVersionResponse(resubmitted));
  } catch (error) {
    next(error);
  }
}

function composeAiDraftInstructions(body: CreateAiDraftEmailTemplateVersionRequest): string {
  const context = [
    body.persona ? `Persona: ${body.persona}.` : null,
    body.workflow_position ? `Workflow position: ${body.workflow_position}.` : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join(' ');

  return context ? `${context} ${body.brief}` : body.brief;
}

/**
 * Generates a new AI DRAFT version on demand — the only other caller of createAiDraftVersion
 * today is the internal Phase 6 diagnosis job. Gated to TEMPLATE_APPROVER_ROLES (narrower than
 * WORKFLOW_ACCESS_ROLES, which can only view templates): the same people who'd ultimately review
 * this draft are the ones trusted to spend a generation call producing it.
 *
 * Deliberately does NOT call submitForReview — per CLAUDE.md's human-in-the-loop rule, this stays
 * DRAFT until a human reads it and explicitly submits it, same as a hand-authored draft. That
 * submission still has no HTTP route (see resubmitEmailTemplateVersionHandler's doc comment) —
 * this endpoint makes that gap more visible, not less, since it's now easier to reach a DRAFT
 * with no way to move it forward over HTTP.
 */
export async function createAiDraftEmailTemplateVersionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const templateId = getParam(req, 'templateId');
    const template = await getEmailTemplate(templateId);
    assertBelongsToOrg(template, getParam(req, 'orgId'));

    const body = req.body as CreateAiDraftEmailTemplateVersionRequest;
    if (!body.brief?.trim()) {
      res.status(400).json({ error: 'brief is required' });
      return;
    }

    const draft = await createAiDraftVersion(templateId, {
      type: 'new_template',
      instructions: composeAiDraftInstructions(body),
    });
    res.status(201).json(toEmailTemplateVersionResponse(draft));
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

/**
 * @openapi
 * /orgs/{orgId}/email-templates/{templateId}/versions/{versionId}/approve:
 *   post:
 *     summary: Approve a PENDING_APPROVAL email template version
 *     description: >
 *       Transitions the version to APPROVED, sets it as the parent EmailTemplate's
 *       current_version_id, and closes (status: APPROVED) the ReviewTask opened when it was
 *       submitted for review. Gated to TEMPLATE_APPROVER_ROLES (SUPER_ADMIN, ADMIN, BD_ADMIN,
 *       BD_MANAGER, BD_MARKETING) — the same role set `resumeDomain` on SendGuardrail reuses for
 *       its own "human signed off" gate.
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
 *       - in: path
 *         name: versionId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmailTemplateVersionResponse' }
 *       400:
 *         description: Version is not in a state that can transition to APPROVED
 *       403:
 *         description: Caller's role is not authorized to approve
 *       404:
 *         description: Not found
 */
emailTemplateRouter.post(
  '/orgs/:orgId/email-templates/:templateId/versions/:versionId/approve',
  requireOrgAccess(getOrgIdParam),
  requireRole(TEMPLATE_APPROVER_ROLES),
  approveEmailTemplateVersionHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/email-templates/{templateId}/versions/{versionId}/reject:
 *   post:
 *     summary: Reject a PENDING_APPROVAL email template version
 *     description: >
 *       Transitions the version to REJECTED and closes (status: REJECTED) the associated
 *       ReviewTask, recording the given reason on it. Gated to TEMPLATE_APPROVER_ROLES, same as
 *       approve.
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
 *       - in: path
 *         name: versionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RejectEmailTemplateVersionRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmailTemplateVersionResponse' }
 *       400:
 *         description: Missing reason, or version is not in a state that can transition to REJECTED
 *       403:
 *         description: Caller's role is not authorized to reject
 *       404:
 *         description: Not found
 */
emailTemplateRouter.post(
  '/orgs/:orgId/email-templates/:templateId/versions/:versionId/reject',
  requireOrgAccess(getOrgIdParam),
  requireRole(TEMPLATE_APPROVER_ROLES),
  rejectEmailTemplateVersionHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/email-templates/{templateId}/versions/{versionId}/resubmit:
 *   post:
 *     summary: Resubmit a REJECTED email template version for another review pass
 *     description: >
 *       Applies optional edits, moves the version REJECTED -> RESUBMITTED, then immediately
 *       submits it for review again (RESUBMITTED -> PENDING_APPROVAL), opening a fresh ReviewTask
 *       — resubmitVersion alone would leave nothing actionable for a reviewer. Gated to
 *       WORKFLOW_ACCESS_ROLES (the same role set that can view/act on templates generally), not
 *       TEMPLATE_APPROVER_ROLES — resubmitting is the original author's action, not a reviewer's.
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
 *       - in: path
 *         name: versionId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/ResubmitEmailTemplateVersionRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmailTemplateVersionResponse' }
 *       400:
 *         description: Version is not in a state that can be resubmitted
 *       404:
 *         description: Not found
 */
emailTemplateRouter.post(
  '/orgs/:orgId/email-templates/:templateId/versions/:versionId/resubmit',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  resubmitEmailTemplateVersionHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/email-templates/{templateId}/versions/ai-draft:
 *   post:
 *     summary: Generate a new AI draft version for this template on demand
 *     description: >
 *       Wraps createAiDraftVersion (previously only reachable from the internal Phase 6
 *       diagnosis job) behind an HTTP route. persona/workflow_position are optional context
 *       folded into the generation instructions — the EmailTemplate's own stored persona/
 *       workflow_position already drive reference-example lookup regardless. brief is the actual
 *       content ask and is required. Always creates a DRAFT — never auto-submits it for review,
 *       per the human-in-the-loop rule. Gated to TEMPLATE_APPROVER_ROLES, not
 *       WORKFLOW_ACCESS_ROLES.
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
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateAiDraftEmailTemplateVersionRequest' }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EmailTemplateVersionResponse' }
 *       400:
 *         description: Missing brief
 *       404:
 *         description: Not found
 */
emailTemplateRouter.post(
  '/orgs/:orgId/email-templates/:templateId/versions/ai-draft',
  requireOrgAccess(getOrgIdParam),
  requireRole(TEMPLATE_APPROVER_ROLES),
  createAiDraftEmailTemplateVersionHandler,
);

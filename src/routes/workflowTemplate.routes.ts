import { Router, type NextFunction, type Request, type Response } from 'express';
import { WORKFLOW_ACCESS_ROLES } from '../constants/workflow';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import { enrollSavedList } from '../services/enrollment.service';
import {
  WorkflowTemplateNotFoundError,
  createWorkflowTemplate,
  getWorkflowTemplate,
  listWorkflowTemplatesForOrg,
  updateWorkflowTemplate,
} from '../services/workflowTemplate.service';
import type {
  CreateWorkflowTemplateRequest,
  EnrollSavedListRequest,
  UpdateWorkflowTemplateRequest,
  WorkflowTemplateResponse,
} from '../types/api/workflow';
import type { WorkflowTemplateDocument } from '../models/WorkflowTemplate.model';
import { getParam } from '../utils/params';

const getOrgIdParam = (req: Request) => getParam(req, 'orgId');

function toWorkflowTemplateResponse(template: WorkflowTemplateDocument): WorkflowTemplateResponse {
  return JSON.parse(JSON.stringify(template)) as WorkflowTemplateResponse;
}

/** Throws WorkflowTemplateNotFoundError if the template doesn't belong to this org — treated as
 * "not found" rather than "forbidden" so a guessed id from another org doesn't confirm it exists. */
function assertBelongsToOrg(template: WorkflowTemplateDocument, orgId: string): void {
  if (template.org_id.toString() !== orgId) {
    throw new WorkflowTemplateNotFoundError(template._id.toString());
  }
}

export async function createWorkflowTemplateHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as CreateWorkflowTemplateRequest;
    const template = await createWorkflowTemplate(getParam(req, 'orgId'), body);
    res.status(201).json(toWorkflowTemplateResponse(template));
  } catch (error) {
    next(error);
  }
}

export async function listWorkflowTemplatesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templates = await listWorkflowTemplatesForOrg(getParam(req, 'orgId'));
    res.json(templates.map(toWorkflowTemplateResponse));
  } catch (error) {
    next(error);
  }
}

export async function getWorkflowTemplateHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const template = await getWorkflowTemplate(getParam(req, 'templateId'));
    assertBelongsToOrg(template, getParam(req, 'orgId'));
    res.json(toWorkflowTemplateResponse(template));
  } catch (error) {
    next(error);
  }
}

export async function updateWorkflowTemplateHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templateId = getParam(req, 'templateId');
    const existing = await getWorkflowTemplate(templateId);
    assertBelongsToOrg(existing, getParam(req, 'orgId'));

    const body = req.body as UpdateWorkflowTemplateRequest;
    const template = await updateWorkflowTemplate(templateId, body);
    res.json(toWorkflowTemplateResponse(template));
  } catch (error) {
    next(error);
  }
}

export async function enrollSavedListHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const templateId = getParam(req, 'templateId');
    const existing = await getWorkflowTemplate(templateId);
    assertBelongsToOrg(existing, getParam(req, 'orgId'));

    const body = req.body as EnrollSavedListRequest;
    const result = await enrollSavedList(templateId, body.saved_list_id);
    res.status(201).json({
      enrolled_count: result.enrolledCount,
      skipped_count: result.skippedCount,
      enrollment_ids: result.enrollmentIds,
      rejected_count: result.rejections.length,
      rejections: result.rejections.map((rejection) => ({ lead_id: rejection.leadId, reason: rejection.reason })),
    });
  } catch (error) {
    next(error);
  }
}

export const workflowTemplateRouter = Router();

workflowTemplateRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /orgs/{orgId}/workflow-templates:
 *   post:
 *     summary: Create a workflow template
 *     tags: [WorkflowTemplates]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateWorkflowTemplateRequest' }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/WorkflowTemplateResponse' }
 */
workflowTemplateRouter.post(
  '/orgs/:orgId/workflow-templates',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  createWorkflowTemplateHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/workflow-templates:
 *   get:
 *     summary: List workflow templates for an org
 *     tags: [WorkflowTemplates]
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
 *               items: { $ref: '#/components/schemas/WorkflowTemplateResponse' }
 */
workflowTemplateRouter.get(
  '/orgs/:orgId/workflow-templates',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  listWorkflowTemplatesHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/workflow-templates/{templateId}:
 *   get:
 *     summary: Get a single workflow template
 *     tags: [WorkflowTemplates]
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
 *             schema: { $ref: '#/components/schemas/WorkflowTemplateResponse' }
 *       404:
 *         description: Not found
 */
workflowTemplateRouter.get(
  '/orgs/:orgId/workflow-templates/:templateId',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  getWorkflowTemplateHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/workflow-templates/{templateId}:
 *   patch:
 *     summary: Edit a workflow template (name, requires_warmup, and/or steps)
 *     description: >
 *       Never affects an Enrollment already running against this template — Enrollment.steps is
 *       a separate, frozen snapshot taken at enrollment time.
 *     tags: [WorkflowTemplates]
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
 *           schema: { $ref: '#/components/schemas/UpdateWorkflowTemplateRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/WorkflowTemplateResponse' }
 *       404:
 *         description: Not found
 */
workflowTemplateRouter.patch(
  '/orgs/:orgId/workflow-templates/:templateId',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  updateWorkflowTemplateHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/workflow-templates/{templateId}/enrollments:
 *   post:
 *     summary: Enroll every lead in a SavedList into this workflow template
 *     tags: [Enrollments]
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
 *           schema: { $ref: '#/components/schemas/EnrollSavedListRequest' }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/EnrollSavedListResponse' }
 *       400:
 *         description: Empty template, or the SavedList belongs to a different org
 *       404:
 *         description: Template or SavedList not found
 */
workflowTemplateRouter.post(
  '/orgs/:orgId/workflow-templates/:templateId/enrollments',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  enrollSavedListHandler,
);

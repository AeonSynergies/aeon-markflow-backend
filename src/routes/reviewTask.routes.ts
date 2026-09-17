import { Router, type NextFunction, type Request, type Response } from 'express';
import { WORKFLOW_ACCESS_ROLES } from '../constants/workflow';
import { REVIEW_TASK_KINDS, REVIEW_TASK_STATUSES, type ReviewTaskKind, type ReviewTaskStatus } from '../constants/reviewTask';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import { listReviewTasksForOrg } from '../services/reviewTask.service';
import type { ReviewTaskResponse } from '../types/api/reviewTask';
import type { ReviewTaskDocument } from '../models/ReviewTask.model';
import { getParam } from '../utils/params';

const getOrgIdParam = (req: Request) => getParam(req, 'orgId');

function toReviewTaskResponse(task: ReviewTaskDocument): ReviewTaskResponse {
  return JSON.parse(JSON.stringify(task)) as ReviewTaskResponse;
}

function parseStatusQuery(req: Request): ReviewTaskStatus | undefined {
  const raw = req.query.status;
  if (typeof raw !== 'string') return undefined;
  return (REVIEW_TASK_STATUSES as readonly string[]).includes(raw) ? (raw as ReviewTaskStatus) : undefined;
}

function parseKindQuery(req: Request): ReviewTaskKind | undefined {
  const raw = req.query.kind;
  if (typeof raw !== 'string') return undefined;
  return (REVIEW_TASK_KINDS as readonly string[]).includes(raw) ? (raw as ReviewTaskKind) : undefined;
}

export async function listReviewTasksHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tasks = await listReviewTasksForOrg(getParam(req, 'orgId'), {
      status: parseStatusQuery(req),
      kind: parseKindQuery(req),
    });
    res.json(tasks.map(toReviewTaskResponse));
  } catch (error) {
    next(error);
  }
}

export const reviewTaskRouter = Router();

reviewTaskRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /orgs/{orgId}/review-tasks:
 *   get:
 *     summary: List an org's ReviewTasks
 *     description: >
 *       Defaults to status=OPEN — the actionable queue. ReviewTask is generic across five kinds
 *       (email_template_version, domain_guardrail, email_version_deliverability,
 *       send_time_recommendation, lead_unsubscribe_request); pass kind to narrow to one. This is
 *       what lets a Template Review queue UI list open email_template_version tasks directly,
 *       instead of inferring "pending" purely from EmailTemplate/EmailTemplateVersion status.
 *     tags: [EmailTemplates]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         required: false
 *         schema:
 *           type: string
 *           enum: [OPEN, APPROVED, REJECTED]
 *       - in: query
 *         name: kind
 *         required: false
 *         schema:
 *           type: string
 *           enum:
 *             [
 *               email_template_version,
 *               domain_guardrail,
 *               email_version_deliverability,
 *               send_time_recommendation,
 *               lead_unsubscribe_request,
 *             ]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/ReviewTaskResponse' }
 */
reviewTaskRouter.get(
  '/orgs/:orgId/review-tasks',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  listReviewTasksHandler,
);

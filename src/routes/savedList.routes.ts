import { Router, type NextFunction, type Request, type Response } from 'express';
import { WORKFLOW_ACCESS_ROLES } from '../constants/workflow';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import {
  SavedListNotFoundError,
  addLeadsToSavedList,
  createSavedList,
  getSavedList,
  listSavedListsForOrg,
  toSavedListSummary,
  type SavedListSummary,
} from '../services/savedList.service';
import type {
  AddLeadsToSavedListRequest,
  CreateSavedListRequest,
  SavedListBulkActionResponse,
  SavedListResponse,
} from '../types/api/savedList';
import type { SavedListDocument } from '../models/SavedList.model';
import { getParam } from '../utils/params';

const getOrgIdParam = (req: Request) => getParam(req, 'orgId');

function toSavedListResponse(summary: SavedListSummary): SavedListResponse {
  return {
    _id: summary.savedListId,
    org_id: summary.orgId,
    name: summary.name,
    lead_count: summary.leadCount,
    created_by: summary.createdBy,
    createdAt: summary.createdAt.toISOString(),
    updatedAt: summary.updatedAt.toISOString(),
  };
}

/** Same not-found-not-forbidden masking used across every other org-scoped resource in this
 * API — a guessed id from another org 404s instead of confirming it exists via a 403. */
function assertBelongsToOrg(savedList: SavedListDocument, orgId: string): void {
  if (savedList.org_id.toString() !== orgId) {
    throw new SavedListNotFoundError(savedList._id.toString());
  }
}

export async function createSavedListHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = getParam(req, 'orgId');
    const body = req.body as CreateSavedListRequest;
    const { savedList, addedCount, skippedCount } = await createSavedList(
      orgId,
      body.name,
      body.lead_ids ?? [],
      req.user?.id,
    );
    const response: SavedListBulkActionResponse = {
      saved_list: toSavedListResponse(toSavedListSummary(savedList)),
      added_count: addedCount,
      skipped_count: skippedCount,
    };
    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
}

export async function listSavedListsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const savedLists = await listSavedListsForOrg(getParam(req, 'orgId'));
    res.json(savedLists.map(toSavedListResponse));
  } catch (error) {
    next(error);
  }
}

export async function addLeadsToSavedListHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const savedListId = getParam(req, 'savedListId');
    const existing = await getSavedList(savedListId);
    assertBelongsToOrg(existing, getParam(req, 'orgId'));

    const body = req.body as AddLeadsToSavedListRequest;
    const { savedList, addedCount, skippedCount } = await addLeadsToSavedList(savedListId, body.lead_ids ?? []);
    const response: SavedListBulkActionResponse = {
      saved_list: toSavedListResponse(toSavedListSummary(savedList)),
      added_count: addedCount,
      skipped_count: skippedCount,
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export const savedListRouter = Router();

savedListRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /orgs/{orgId}/saved-lists:
 *   post:
 *     summary: Create a SavedList, optionally seeded with a bulk lead selection
 *     description: >
 *       The Leads screen's "enroll selected leads into a SavedList" bulk action, new-list path.
 *       Workflow-related, per the RBAC table — same access as building/running a workflow, not
 *       the plain Lead view/upload/monitor access BD-Lead Gen has. Any lead_ids not belonging to
 *       this org's own Lead records are dropped rather than trusted, reported via skipped_count.
 *     tags: [SavedLists]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateSavedListRequest' }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SavedListBulkActionResponse' }
 *   get:
 *     summary: List SavedLists for an org
 *     tags: [SavedLists]
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
 *               items: { $ref: '#/components/schemas/SavedListResponse' }
 */
savedListRouter.post(
  '/orgs/:orgId/saved-lists',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  createSavedListHandler,
);

savedListRouter.get(
  '/orgs/:orgId/saved-lists',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  listSavedListsHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/saved-lists/{savedListId}/leads:
 *   post:
 *     summary: Add a bulk lead selection to an existing SavedList
 *     description: >
 *       The Leads screen's "enroll selected leads into a SavedList" bulk action, add-to-existing
 *       path. Deduped against the list's current membership and against lead ids that don't
 *       belong to this org's own Lead records.
 *     tags: [SavedLists]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: savedListId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/AddLeadsToSavedListRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/SavedListBulkActionResponse' }
 *       404:
 *         description: Not found
 */
savedListRouter.post(
  '/orgs/:orgId/saved-lists/:savedListId/leads',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  addLeadsToSavedListHandler,
);

import { Router, type NextFunction, type Request, type Response } from 'express';
import { ADMIN_ONLY_ROLES } from '../constants/access';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import { canAccessOrg } from '../services/orgAccess.service';
import {
  UserAccessGrantNotFoundError,
  createUserAccessGrant,
  getUserAccessGrant,
  listUserAccessGrantsForOrg,
  updateUserAccessGrant,
  type UserAccessGrantView,
} from '../services/userAccessGrant.service';
import type {
  CreateUserAccessGrantRequest,
  UpdateUserAccessGrantRequest,
  UserAccessGrantResponse,
} from '../types/api/userAccessGrant';
import type { UserAccessGrantDocument } from '../models/UserAccessGrant.model';
import { getParam } from '../utils/params';

const getOrgIdParam = (req: Request) => getParam(req, 'orgId');

function toUserAccessGrantResponse(view: UserAccessGrantView): UserAccessGrantResponse {
  return {
    _id: view.grantId,
    user_id: view.userId,
    user_email: view.userEmail,
    app: view.app,
    org_id: view.orgId,
    role: view.role,
    features: view.features,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

/** Same not-found-not-forbidden masking used across every other org-scoped resource in this
 * API — a grant belonging to some other single org (not this one, and not an all-orgs grant)
 * 404s from this org's endpoint rather than confirming it exists via a 403. */
function assertRelevantToOrg(grant: UserAccessGrantDocument, orgId: string): void {
  if (grant.org_id && grant.org_id.toString() !== orgId) {
    throw new UserAccessGrantNotFoundError(grant._id.toString());
  }
}

export async function listUserAccessGrantsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const grants = await listUserAccessGrantsForOrg(getParam(req, 'orgId'));
    res.json(grants.map(toUserAccessGrantResponse));
  } catch (error) {
    next(error);
  }
}

export async function createUserAccessGrantHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgIdParam = getParam(req, 'orgId');
    const body = req.body as CreateUserAccessGrantRequest;
    const targetOrgId = body.org_id === undefined ? orgIdParam : body.org_id;

    // A grant can never scope wider than the caller's own access — otherwise an org-scoped
    // Admin could grant someone access beyond what they themselves hold.
    if (targetOrgId === null) {
      if (!req.orgAccess?.allOrgs) {
        res.status(403).json({ error: 'Only a caller with all-orgs access can grant all-orgs access' });
        return;
      }
    } else if (!canAccessOrg(req.orgAccess!, targetOrgId)) {
      res.status(403).json({ error: 'Not authorized for this organization' });
      return;
    }

    const grant = await createUserAccessGrant({
      userId: body.user_id,
      app: body.app,
      orgId: targetOrgId,
      role: body.role,
      features: body.features,
    });
    res.status(201).json(toUserAccessGrantResponse(grant));
  } catch (error) {
    next(error);
  }
}

export async function updateUserAccessGrantHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const grantId = getParam(req, 'grantId');
    const existing = await getUserAccessGrant(grantId);
    assertRelevantToOrg(existing, getParam(req, 'orgId'));

    const body = req.body as UpdateUserAccessGrantRequest;
    const grant = await updateUserAccessGrant(grantId, body);
    res.json(toUserAccessGrantResponse(grant));
  } catch (error) {
    next(error);
  }
}

export const userAccessGrantRouter = Router();

userAccessGrantRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /orgs/{orgId}/user-access-grants:
 *   get:
 *     summary: List UserAccessGrants relevant to an org (scoped to it, plus any all-orgs grant)
 *     description: Admin/Super Admin only — only Admin/Super Admin can view or manage access grants, per the RBAC table.
 *     tags: [Settings]
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
 *               items: { $ref: '#/components/schemas/UserAccessGrantResponse' }
 *   post:
 *     summary: Create a UserAccessGrant
 *     description: >
 *       Admin/Super Admin only. org_id defaults to the URL's orgId when omitted; passing org_id
 *       explicitly as null (all orgs) or as a different org requires the caller to already hold
 *       access to that wider or different scope themselves — a grant can never exceed the
 *       caller's own access.
 *     tags: [Settings]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/CreateUserAccessGrantRequest' }
 *     responses:
 *       201:
 *         description: Created
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserAccessGrantResponse' }
 *       403:
 *         description: The requested org_id scope exceeds the caller's own access
 */
userAccessGrantRouter.get(
  '/orgs/:orgId/user-access-grants',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  listUserAccessGrantsHandler,
);

userAccessGrantRouter.post(
  '/orgs/:orgId/user-access-grants',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  createUserAccessGrantHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/user-access-grants/{grantId}:
 *   patch:
 *     summary: Update a UserAccessGrant's role and/or features
 *     description: >
 *       Admin/Super Admin only. app, org_id, and user_id are immutable after creation — the
 *       model's own unique index is on that exact triple, so changing any of them is really a
 *       different grant.
 *     tags: [Settings]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: grantId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateUserAccessGrantRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/UserAccessGrantResponse' }
 *       404:
 *         description: Not found
 */
userAccessGrantRouter.patch(
  '/orgs/:orgId/user-access-grants/:grantId',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  updateUserAccessGrantHandler,
);

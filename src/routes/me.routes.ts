import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope } from '../middleware/orgScope.middleware';
import { Organization } from '../models/Organization.model';
import type { MeResponse } from '../types/api/me';

export async function getMeHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const access = req.orgAccess!;
    const orgs = access.allOrgs
      ? await Organization.find({}, 'name').sort({ name: 1 }).lean()
      : await Organization.find({ _id: { $in: access.orgIds } }, 'name').sort({ name: 1 }).lean();

    const response: MeResponse = {
      user: { id: req.user!.id, email: req.user!.email },
      org_access: { all_orgs: access.allOrgs, roles: access.roles },
      orgs: orgs.map((org) => ({ id: org._id.toString(), name: org.name })),
    };
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export const meRouter = Router();

/**
 * @openapi
 * /me:
 *   get:
 *     summary: The authenticated user's own identity, MarkFlow role(s), and accessible orgs
 *     description: >
 *       Not org-scoped — this is what a client calls *before* it knows which org to scope
 *       anything else to (the org switcher, and every role-gated nav link, are built from this).
 *       org_access.roles is the same flat, not-per-org set requireRole itself checks: a user
 *       holding different roles in different orgs is not distinguished here, matching how the
 *       backend actually enforces access today.
 *     tags: [Me]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/MeResponse' }
 *       401:
 *         description: Missing, invalid, or expired token
 */
meRouter.get('/me', requireAuth, attachOrgScope, getMeHandler);

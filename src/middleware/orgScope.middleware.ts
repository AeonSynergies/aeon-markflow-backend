import type { NextFunction, Request, Response } from 'express';
import { getOrgAccessForUser, canAccessOrg } from '../services/orgAccess.service';
import type { App, Role } from '../constants/access';

const MARKFLOW: App = 'markflow';

/**
 * Resolves the authenticated user's org access for MarkFlow and attaches it to the request
 * as req.orgAccess. Must run after requireAuth.
 */
export async function attachOrgScope(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  req.orgAccess = await getOrgAccessForUser(req.user.id, MARKFLOW);
  next();
}

/**
 * Route guard for endpoints scoped to a single org (e.g. /orgs/:orgId/leads). Reads the org
 * id via `getOrgId` and 403s if the caller's grants don't cover it. Must run after
 * attachOrgScope.
 */
export function requireOrgAccess(getOrgId: (req: Request) => string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.orgAccess) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const orgId = getOrgId(req);
    if (!orgId || !canAccessOrg(req.orgAccess, orgId)) {
      res.status(403).json({ error: 'Not authorized for this organization' });
      return;
    }
    next();
  };
}

/**
 * Route guard restricting an action to specific roles (e.g. workflow build/run access is
 * everyone except BD-Lead Gen, per the RBAC table). Must run after attachOrgScope.
 */
export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.orgAccess) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const hasRole = req.orgAccess.roles.some((role) => allowedRoles.includes(role));
    if (!hasRole) {
      res.status(403).json({ error: 'Not authorized for this action' });
      return;
    }
    next();
  };
}

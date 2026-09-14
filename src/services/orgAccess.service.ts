import { Types } from 'mongoose';
import { UserAccessGrant } from '../models/UserAccessGrant.model';
import type { App, Role } from '../constants/access';

export interface OrgAccessSummary {
  /** true when the user holds a grant with org_id === null for this app (access to all orgs). */
  allOrgs: boolean;
  /** Org ids the user has an explicit grant for. Empty when allOrgs is true. */
  orgIds: string[];
  /** Distinct roles held across the user's grants for this app. */
  roles: Role[];
}

const NO_ACCESS: OrgAccessSummary = { allOrgs: false, orgIds: [], roles: [] };

/**
 * Resolves which organizations a user may act on for a given app (markflow/onboard),
 * per the UserAccessGrant model (org_id: null means "all orgs").
 */
export async function getOrgAccessForUser(userId: string, app: App): Promise<OrgAccessSummary> {
  if (!Types.ObjectId.isValid(userId)) {
    return NO_ACCESS;
  }

  const grants = await UserAccessGrant.find({ user_id: userId, app }).lean();
  if (grants.length === 0) {
    return NO_ACCESS;
  }

  const roles = new Set<Role>();
  const orgIds = new Set<string>();
  let allOrgs = false;

  for (const grant of grants) {
    roles.add(grant.role as Role);
    if (grant.org_id === null || grant.org_id === undefined) {
      allOrgs = true;
    } else {
      orgIds.add(grant.org_id.toString());
    }
  }

  return {
    allOrgs,
    orgIds: allOrgs ? [] : Array.from(orgIds),
    roles: Array.from(roles),
  };
}

/** Whether an org access summary permits acting on the given org id. */
export function canAccessOrg(access: OrgAccessSummary, orgId: string): boolean {
  return access.allOrgs || access.orgIds.includes(orgId);
}

/**
 * Builds the org_id fragment for a Mongoose filter given a resolved access summary and an
 * optional explicit org id the caller is requesting (e.g. from a route param).
 * Returns null when the requested org id is outside the caller's access.
 */
export function buildOrgFilter(
  access: OrgAccessSummary,
  explicitOrgId?: string,
): Record<string, unknown> | null {
  if (explicitOrgId) {
    return canAccessOrg(access, explicitOrgId) ? { org_id: explicitOrgId } : null;
  }
  if (access.allOrgs) {
    return {};
  }
  return { org_id: { $in: access.orgIds } };
}

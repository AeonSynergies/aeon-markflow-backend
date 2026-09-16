import { Router, type NextFunction, type Request, type Response } from 'express';
import { ADMIN_ONLY_ROLES } from '../constants/access';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import { getOrganizationSettings, updateOrganizationSettings } from '../services/organizationSettings.service';
import type { OrganizationSettingsResponse, UpdateOrganizationSettingsRequest } from '../types/api/organization';
import type { OrganizationDocument } from '../models/Organization.model';
import { getParam } from '../utils/params';

const getOrgIdParam = (req: Request) => getParam(req, 'orgId');

function toOrganizationSettingsResponse(org: OrganizationDocument): OrganizationSettingsResponse {
  return JSON.parse(JSON.stringify(org)) as OrganizationSettingsResponse;
}

export async function getOrganizationSettingsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const org = await getOrganizationSettings(getParam(req, 'orgId'));
    res.json(toOrganizationSettingsResponse(org));
  } catch (error) {
    next(error);
  }
}

export async function updateOrganizationSettingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as UpdateOrganizationSettingsRequest;
    const org = await updateOrganizationSettings(getParam(req, 'orgId'), body);
    res.json(toOrganizationSettingsResponse(org));
  } catch (error) {
    next(error);
  }
}

export const organizationSettingsRouter = Router();

organizationSettingsRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /orgs/{orgId}/organization:
 *   get:
 *     summary: Get an org's configuration (Settings screen)
 *     description: Admin/Super Admin only, per the RBAC table's treatment of org-level configuration.
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
 *             schema: { $ref: '#/components/schemas/OrganizationSettingsResponse' }
 *       404:
 *         description: Not found
 *   patch:
 *     summary: Update an org's enabled_features, sending_domains, and/or send_time_strategy
 *     description: >
 *       Admin/Super Admin only. sending_domains, if given, fully replaces the array — same
 *       full-replace semantics as a WorkflowTemplate's own `steps` field, not a merge. Does not
 *       touch name, product_context, or brand_voice_guidelines_id.
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
 *           schema: { $ref: '#/components/schemas/UpdateOrganizationSettingsRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/OrganizationSettingsResponse' }
 *       400:
 *         description: Validation error (e.g. an unknown sending_domains purpose)
 *       404:
 *         description: Not found
 */
organizationSettingsRouter.get(
  '/orgs/:orgId/organization',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  getOrganizationSettingsHandler,
);

organizationSettingsRouter.patch(
  '/orgs/:orgId/organization',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  updateOrganizationSettingsHandler,
);

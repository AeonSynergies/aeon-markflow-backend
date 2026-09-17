import { Router, type NextFunction, type Request, type Response } from 'express';
import { ADMIN_ONLY_ROLES } from '../constants/access';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import {
  deleteGuardrailSettings,
  getGuardrailSettingsView,
  listGuardrailSettingsViewsForOrg,
  upsertGuardrailSettings,
  type GuardrailSettingsView,
} from '../services/guardrailSettings.service';
import { Organization } from '../models/Organization.model';
import type { GuardrailSettingsResponse, UpsertGuardrailSettingsRequest } from '../types/api/guardrailSettings';
import { getParam } from '../utils/params';

const getOrgIdParam = (req: Request) => getParam(req, 'orgId');

function toGuardrailSettingsResponse(view: GuardrailSettingsView): GuardrailSettingsResponse {
  return {
    org_id: view.orgId,
    domain: view.domain,
    ramp_up_starting_daily_cap: view.settings.rampUpStartingDailyCap,
    ramp_up_step_multiplier: view.settings.rampUpStepMultiplier,
    ramp_up_step_interval_days: view.settings.rampUpStepIntervalDays,
    ramp_up_steady_state_daily_cap: view.settings.rampUpSteadyStateDailyCap,
    guardrail_short_window_hours: view.settings.guardrailShortWindowHours,
    guardrail_long_window_days: view.settings.guardrailLongWindowDays,
    guardrail_min_sample_size: view.settings.guardrailMinSampleSize,
    throttle_bounce_rate: view.settings.throttleBounceRate,
    throttle_complaint_rate: view.settings.throttleComplaintRate,
    hard_stop_bounce_rate: view.settings.hardStopBounceRate,
    hard_stop_complaint_rate: view.settings.hardStopComplaintRate,
    has_override: view.hasOverride,
    overridden_fields: view.overriddenFields,
  };
}

export async function listGuardrailSettingsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orgId = getParam(req, 'orgId');
    const org = await Organization.findById(orgId).lean();
    const domains = org ? org.sending_domains.map((entry) => entry.domain) : [];

    const views = await listGuardrailSettingsViewsForOrg(orgId, domains);
    res.json(views.map(toGuardrailSettingsResponse));
  } catch (error) {
    next(error);
  }
}

export async function getGuardrailSettingsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const view = await getGuardrailSettingsView(getParam(req, 'orgId'), getParam(req, 'domain'));
    res.json(toGuardrailSettingsResponse(view));
  } catch (error) {
    next(error);
  }
}

export async function upsertGuardrailSettingsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as UpsertGuardrailSettingsRequest;
    const view = await upsertGuardrailSettings(getParam(req, 'orgId'), getParam(req, 'domain'), body);
    res.json(toGuardrailSettingsResponse(view));
  } catch (error) {
    next(error);
  }
}

export async function deleteGuardrailSettingsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await deleteGuardrailSettings(getParam(req, 'orgId'), getParam(req, 'domain'));
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

export const guardrailSettingsRouter = Router();

guardrailSettingsRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /orgs/{orgId}/guardrail-settings:
 *   get:
 *     summary: List SendGuardrail settings for every one of an org's configured sending domains
 *     description: >
 *       Admin/Super Admin only. One row per Organization.sending_domains[] entry, each showing
 *       the currently *effective* values (a per-domain override merged over the hardcoded
 *       defaults in src/constants/sendGuardrail.ts) plus which fields, if any, are overridden.
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
 *               items: { $ref: '#/components/schemas/GuardrailSettingsResponse' }
 */
guardrailSettingsRouter.get(
  '/orgs/:orgId/guardrail-settings',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  listGuardrailSettingsHandler,
);

/**
 * @openapi
 * /orgs/{orgId}/guardrail-settings/{domain}:
 *   get:
 *     summary: Get the effective SendGuardrail settings for one (org, domain) pair
 *     tags: [Settings]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: domain
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK — always 200, even with no override (returns the hardcoded defaults)
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/GuardrailSettingsResponse' }
 *   put:
 *     summary: Upsert a per-(org, domain) override of SendGuardrail's ramp-up numbers/thresholds
 *     description: >
 *       Admin/Super Admin only. Only the fields present in the body are written — a field left
 *       out keeps its previously-stored value (or stays unset/default), the same partial-PATCH
 *       semantics as everywhere else in this codebase. Takes effect on the very next canSend()
 *       check; nothing needs a restart or redeploy.
 *     tags: [Settings]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: domain
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpsertGuardrailSettingsRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/GuardrailSettingsResponse' }
 *   delete:
 *     summary: Remove the override — every field for this (org, domain) reverts to the hardcoded default
 *     description: Admin/Super Admin only. Idempotent — deleting a pair with no override is a no-op.
 *     tags: [Settings]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: domain
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       204:
 *         description: No Content
 */
guardrailSettingsRouter.get(
  '/orgs/:orgId/guardrail-settings/:domain',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  getGuardrailSettingsHandler,
);

guardrailSettingsRouter.put(
  '/orgs/:orgId/guardrail-settings/:domain',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  upsertGuardrailSettingsHandler,
);

guardrailSettingsRouter.delete(
  '/orgs/:orgId/guardrail-settings/:domain',
  requireOrgAccess(getOrgIdParam),
  requireRole(ADMIN_ONLY_ROLES),
  deleteGuardrailSettingsHandler,
);

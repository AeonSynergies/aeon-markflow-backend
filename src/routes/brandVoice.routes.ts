import { Router, type NextFunction, type Request, type Response } from 'express';
import { ADMIN_ONLY_ROLES } from '../constants/access';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireRole } from '../middleware/orgScope.middleware';
import { getBrandVoiceGuidelines, updateBrandVoiceGuidelines } from '../services/brandVoice.service';
import type { BrandVoiceGuidelinesResponse, UpdateBrandVoiceGuidelinesRequest } from '../types/api/brandVoice';

export async function getBrandVoiceGuidelinesHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const guidelines = await getBrandVoiceGuidelines();
    const response: BrandVoiceGuidelinesResponse = guidelines;
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function updateBrandVoiceGuidelinesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as UpdateBrandVoiceGuidelinesRequest;
    const guidelines = await updateBrandVoiceGuidelines(body.text, req.user?.id);
    const response: BrandVoiceGuidelinesResponse = guidelines;
    res.json(response);
  } catch (error) {
    next(error);
  }
}

export const brandVoiceRouter = Router();

brandVoiceRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /brand-voice:
 *   get:
 *     summary: Get the current Brand Voice guidelines
 *     description: >
 *       Admin/Super Admin only. Not org-scoped — there is exactly one current guidelines
 *       document, shared by every org's AI email generation (see brandVoice.service.ts for why
 *       Organization.brand_voice_guidelines_id doesn't factor in here). No :orgId in the path,
 *       deliberately: nesting it under one org's Settings screen would incorrectly imply the edit
 *       is scoped to that org, when it actually affects every org's generated drafts.
 *     tags: [Settings]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BrandVoiceGuidelinesResponse' }
 *   put:
 *     summary: Replace the current Brand Voice guidelines
 *     description: Admin/Super Admin only. Affects every org's next AI-generated draft immediately.
 *     tags: [Settings]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/UpdateBrandVoiceGuidelinesRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/BrandVoiceGuidelinesResponse' }
 */
brandVoiceRouter.get('/brand-voice', requireRole(ADMIN_ONLY_ROLES), getBrandVoiceGuidelinesHandler);

brandVoiceRouter.put('/brand-voice', requireRole(ADMIN_ONLY_ROLES), updateBrandVoiceGuidelinesHandler);

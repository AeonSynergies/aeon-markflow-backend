import { Router, type NextFunction, type Request, type Response } from 'express';
import { ADMIN_ONLY_ROLES } from '../constants/access';
import { WORKFLOW_ACCESS_ROLES } from '../constants/workflow';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireRole } from '../middleware/orgScope.middleware';
import { listGenericCrossOrgInsights, listRawCrossOrgInsights } from '../services/crossOrgInsight.service';

export async function listCrossOrgInsightsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const insights = await listGenericCrossOrgInsights();
    res.json(
      insights.map((insight) => ({
        insight_type: insight.insightType,
        workflow_type: insight.workflowType,
        persona: insight.persona,
        step_kinds: insight.stepKinds,
        step_count: insight.stepCount,
        day_of_week: insight.dayOfWeek,
        hour_bucket: insight.hourBucket,
        timezone_bucket: insight.timezoneBucket,
        confidence: insight.confidence,
      })),
    );
  } catch (error) {
    next(error);
  }
}

export async function listRawCrossOrgInsightsHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const insights = await listRawCrossOrgInsights();
    res.json(JSON.parse(JSON.stringify(insights)));
  } catch (error) {
    next(error);
  }
}

export const crossOrgInsightRouter = Router();

crossOrgInsightRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /cross-org-insights:
 *   get:
 *     summary: Generic cross-org recommendations for the workflow builder
 *     description: >
 *       Abstracted structural/timing patterns (sequence shape, step counts, send-time windows)
 *       observed across at least several distinct orgs — never one org's raw content or
 *       org-specific metrics. Available to any workflow-access role. Only a coarse confidence
 *       label is included; see /cross-org-insights/raw for the underlying numbers.
 *     tags: [CrossOrgInsights]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/CrossOrgInsightResponse' }
 */
crossOrgInsightRouter.get('/cross-org-insights', requireRole(WORKFLOW_ACCESS_ROLES), listCrossOrgInsightsHandler);

/**
 * @openapi
 * /cross-org-insights/raw:
 *   get:
 *     summary: Raw cross-org insight data (Admin/Super Admin only)
 *     description: >
 *       The same patterns as /cross-org-insights, plus the exact org_count/sample_size/
 *       avg_reply_rate/avg_meeting_rate pooled across every qualifying org.
 *     tags: [CrossOrgInsights]
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/RawCrossOrgInsightResponse' }
 *       403:
 *         description: Not authorized (Admin/Super Admin only)
 */
crossOrgInsightRouter.get('/cross-org-insights/raw', requireRole(ADMIN_ONLY_ROLES), listRawCrossOrgInsightsHandler);

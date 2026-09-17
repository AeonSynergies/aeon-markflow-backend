import { Router, type NextFunction, type Request, type Response } from 'express';
import { RECYCLED_SEGMENT_ROLES } from '../constants/access';
import { LEAD_STATUSES, type LeadStatus } from '../constants/lead';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess } from '../middleware/orgScope.middleware';
import { listLeadsForOrg, type LeadListItem } from '../services/lead.service';
import type { LeadResponse } from '../types/api/lead';
import { getParam } from '../utils/params';

const getOrgIdParam = (req: Request) => getParam(req, 'orgId');

function toLeadResponse(lead: LeadListItem): LeadResponse {
  return {
    _id: lead.leadId,
    org_id: lead.orgId,
    contact_id: lead.contactId,
    name: lead.name,
    company: lead.company,
    email: lead.email,
    phone: lead.phone,
    status: lead.status,
    email_deliverability: lead.emailDeliverability,
    phone_dnd_status: lead.phoneDndStatus,
    lost_reason: lead.lostReason,
    lost_stage: lead.lostStage,
    recycled_from_deal_id: lead.recycledFromDealId,
    eligible_for_reengagement_at: lead.eligibleForReengagementAt ? lead.eligibleForReengagementAt.toISOString() : null,
    createdAt: lead.createdAt.toISOString(),
    updatedAt: lead.updatedAt.toISOString(),
  };
}

function parseStringQuery(req: Request, name: string): string | undefined {
  const raw = req.query[name];
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
}

function parseStatusQuery(req: Request): LeadStatus | undefined {
  const raw = req.query.status;
  return typeof raw === 'string' && (LEAD_STATUSES as readonly string[]).includes(raw) ? (raw as LeadStatus) : undefined;
}

export async function listLeadsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const recycledSegment = parseStringQuery(req, 'segment') === 'recycled';

    // Per the RBAC table, the Recycled/Win-back segment is visible to a narrower role set than
    // Lead viewing in general (RECYCLED_SEGMENT_ROLES) — gated here rather than at the router
    // level since it's a filter on this endpoint, not a separate one.
    if (recycledSegment) {
      const roles = req.orgAccess?.roles ?? [];
      const allowed = roles.some((role) => RECYCLED_SEGMENT_ROLES.includes(role));
      if (!allowed) {
        res.status(403).json({ error: 'Not authorized to view the Recycled/Win-back segment' });
        return;
      }
    }

    const leads = await listLeadsForOrg(getParam(req, 'orgId'), {
      status: parseStatusQuery(req),
      recycledSegment,
      search: parseStringQuery(req, 'search'),
    });
    res.json(leads.map(toLeadResponse));
  } catch (error) {
    next(error);
  }
}

export const leadRouter = Router();

leadRouter.use(requireAuth, attachOrgScope);

/**
 * @openapi
 * /orgs/{orgId}/leads:
 *   get:
 *     summary: List/filter/search Leads for an org
 *     description: >
 *       Open to every role with org access, including BD-Lead Gen (view/upload/monitor only,
 *       per the RBAC table) — no workflow-related action happens here. `segment=recycled`
 *       narrows to the Recycled/Win-back segment (status RECLAIMED, with lost_reason/lost_stage
 *       populated) and is itself gated to BD-Sales/BD-Manager/Admin/Super Admin; any other role
 *       requesting it gets 403 rather than a silently-filtered result. `search` matches the
 *       lead's Contact name/company — since a Contact can be a Lead in more than one org, this
 *       always resolves back to *this org's own* Lead record, never another org's.
 *     tags: [Leads]
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
 *           enum: [NEW-COLD, NEW-INBOUND, CONTACTED, CONTACTED-PHONE, CONTACTED-EMAIL, PROSPECT, INACTIVE, RECLAIMED]
 *       - in: query
 *         name: segment
 *         required: false
 *         description: Pass "recycled" for the Recycled/Win-back segment (status RECLAIMED).
 *         schema: { type: string, enum: [recycled] }
 *       - in: query
 *         name: search
 *         required: false
 *         description: Case-insensitive substring match against the lead's Contact name/company.
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items: { $ref: '#/components/schemas/LeadResponse' }
 *       403:
 *         description: segment=recycled requested by a role outside RECYCLED_SEGMENT_ROLES
 */
leadRouter.get('/orgs/:orgId/leads', requireOrgAccess(getOrgIdParam), listLeadsHandler);

import { Router, type NextFunction, type Request, type Response } from 'express';
import { RECYCLED_SEGMENT_ROLES } from '../constants/access';
import { LEAD_STATUSES, type LeadStatus } from '../constants/lead';
import { WORKFLOW_ACCESS_ROLES } from '../constants/workflow';
import { requireAuth } from '../middleware/auth.middleware';
import { attachOrgScope, requireOrgAccess, requireRole } from '../middleware/orgScope.middleware';
import { getLeadForOrg, listLeadsForOrg, type LeadListItem } from '../services/lead.service';
import { recycleLead } from '../services/leadRecycle.service';
import type { LeadResponse, RecycleLeadRequest } from '../types/api/lead';
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
 *       narrows to the Recycled/Win-back segment (status RECLAIMED or DISCOVERY_RETRY, with
 *       lost_reason/lost_stage populated) and is itself gated to BD-Sales/BD-Manager/Admin/Super
 *       Admin; any other role requesting it gets 403 rather than a silently-filtered result.
 *       `search` matches the lead's Contact name/company — since a Contact can be a Lead in more
 *       than one org, this always resolves back to *this org's own* Lead record, never another
 *       org's.
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
 *           enum: [NEW-COLD, NEW-INBOUND, CONTACTED, CONTACTED-PHONE, CONTACTED-EMAIL, PROSPECT, INACTIVE, RECLAIMED, DISCOVERY_RETRY]
 *       - in: query
 *         name: segment
 *         required: false
 *         description: >
 *           Pass "recycled" for the Recycled/Win-back segment (status RECLAIMED or
 *           DISCOVERY_RETRY).
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

export async function recycleLeadHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = req.body as RecycleLeadRequest;
    if (!body.deal_id?.trim() || !body.lost_reason?.trim() || !body.lost_stage?.trim()) {
      res.status(400).json({ error: 'deal_id, lost_reason, and lost_stage are required' });
      return;
    }

    const orgId = getParam(req, 'orgId');
    const leadId = getParam(req, 'leadId');

    await recycleLead(orgId, leadId, {
      dealId: body.deal_id,
      lostReason: body.lost_reason,
      lostStage: body.lost_stage,
      eligibleForReengagementAt: body.eligible_for_reengagement_at ? new Date(body.eligible_for_reengagement_at) : undefined,
    });

    const updated = await getLeadForOrg(orgId, leadId);
    res.json(toLeadResponse(updated!));
  } catch (error) {
    next(error);
  }
}

/**
 * @openapi
 * /orgs/{orgId}/leads/{leadId}/recycle:
 *   post:
 *     summary: Receive the Lost+Recycle event for one Lead
 *     description: >
 *       The receiving side of the Onboard → MarkFlow Lost+Recycle event (see CLAUDE.md's "Repos,
 *       backend separation" section) — Onboard's own build is still deferred, so nothing calls
 *       this yet; it's exercised directly today (tests, or calling it by hand) until a real
 *       webhook takes over that job. Sets recycled_from_deal_id/lost_reason/lost_stage/
 *       eligible_for_reengagement_at, and routes status to DISCOVERY_RETRY when lost_reason is
 *       no_show or cancelled_discovery (a Discovery call was already booked — urgent
 *       reschedule-focused follow-up), otherwise RECLAIMED (the general win-back tier).
 *     tags: [Leads]
 *     parameters:
 *       - in: path
 *         name: orgId
 *         required: true
 *         schema: { type: string }
 *       - in: path
 *         name: leadId
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/RecycleLeadRequest' }
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema: { $ref: '#/components/schemas/LeadResponse' }
 *       400:
 *         description: Missing deal_id, lost_reason, or lost_stage
 *       404:
 *         description: Not found
 */
leadRouter.post(
  '/orgs/:orgId/leads/:leadId/recycle',
  requireOrgAccess(getOrgIdParam),
  requireRole(WORKFLOW_ACCESS_ROLES),
  recycleLeadHandler,
);

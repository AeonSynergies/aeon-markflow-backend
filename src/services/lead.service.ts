import { Contact, type ContactDocument } from '../models/Contact.model';
import { Lead } from '../models/Lead.model';
import type { EmailDeliverabilityStatus, LeadStatus } from '../constants/lead';

export interface ListLeadsFilters {
  status?: LeadStatus;
  /** The Recycled/Win-back segment — status: RECLAIMED, regardless of `status`. RBAC-gated by the caller (route layer), not here. */
  recycledSegment?: boolean;
  /** Case-insensitive substring match against the lead's Contact name or company. */
  search?: string;
}

export interface LeadListItem {
  leadId: string;
  orgId: string;
  contactId: string;
  name: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  status: LeadStatus;
  emailDeliverability: EmailDeliverabilityStatus;
  phoneDndStatus: boolean;
  lostReason: string | null;
  lostStage: string | null;
  recycledFromDealId: string | null;
  eligibleForReengagementAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toLeadListItem(
  lead: {
    _id: { toString(): string };
    org_id: { toString(): string };
    contact_id: { toString(): string };
    status: string;
    email_deliverability: string;
    phone_dnd_status: boolean;
    lost_reason?: string | null;
    lost_stage?: string | null;
    recycled_from_deal_id?: { toString(): string } | null;
    eligible_for_reengagement_at?: Date | null;
    createdAt: Date;
    updatedAt: Date;
  },
  contact: ContactDocument | undefined,
): LeadListItem {
  return {
    leadId: lead._id.toString(),
    orgId: lead.org_id.toString(),
    contactId: lead.contact_id.toString(),
    name: contact?.name ?? null,
    company: contact?.company ?? null,
    email: contact?.email ?? null,
    phone: contact?.phone ?? null,
    status: lead.status as LeadStatus,
    emailDeliverability: lead.email_deliverability as EmailDeliverabilityStatus,
    phoneDndStatus: lead.phone_dnd_status,
    lostReason: lead.lost_reason ?? null,
    lostStage: lead.lost_stage ?? null,
    recycledFromDealId: lead.recycled_from_deal_id ? lead.recycled_from_deal_id.toString() : null,
    eligibleForReengagementAt: lead.eligible_for_reengagement_at ?? null,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  };
}

/**
 * Lists Leads for one org — filterable by lifecycle status, the Recycled/Win-back segment, and
 * searchable by the lead's Contact name/company. A Contact is shared across orgs (the same
 * person can be a Lead for more than one org), so a name/company search resolves matching
 * Contact ids first and then intersects with *this org's own* Lead records — every field in the
 * response (status, lost_reason, lost_stage, ...) always comes from this org's Lead document,
 * never a Lead belonging to the matched Contact in some other org.
 */
export async function listLeadsForOrg(orgId: string, filters: ListLeadsFilters = {}): Promise<LeadListItem[]> {
  const query: Record<string, unknown> = { org_id: orgId };

  if (filters.recycledSegment) {
    query.status = 'RECLAIMED';
  } else if (filters.status) {
    query.status = filters.status;
  }

  if (filters.search) {
    const pattern = new RegExp(escapeRegex(filters.search), 'i');
    const matchingContacts = await Contact.find({ $or: [{ name: pattern }, { company: pattern }] }, '_id').lean();
    if (matchingContacts.length === 0) return [];
    query.contact_id = { $in: matchingContacts.map((contact) => contact._id) };
  }

  const leads = await Lead.find(query).sort({ createdAt: -1 }).lean();
  if (leads.length === 0) return [];

  const contacts = await Contact.find({ _id: { $in: leads.map((lead) => lead.contact_id) } }).lean();
  const contactsById = new Map(contacts.map((contact) => [contact._id.toString(), contact as ContactDocument]));

  return leads.map((lead) => toLeadListItem(lead, contactsById.get(lead.contact_id.toString())));
}

// marketing: MarkFlow's own workflow engine sends (cold outreach, sequences) — subject to
// DomainRouter + SendGuardrail.
// transactional: the org's existing non-MarkFlow send path (e.g. nodemailer), untouched by
// MarkFlow — listed here only so DomainRouter can tell it apart from a marketing domain.
// alerts: an org's own automated system-to-customer alerts, if/when that becomes a MarkFlow
// feature — distinct from MarkFlow's own internal ops notifications (ReviewTask/SendGuardrail
// alerts), which go through a fixed deployment-level mailbox, not any org's sending_domains[].
// See CLAUDE.md's "Domain purpose model" section.
export const SENDING_DOMAIN_PURPOSES = ['marketing', 'transactional', 'alerts'] as const;
export type SendingDomainPurpose = (typeof SENDING_DOMAIN_PURPOSES)[number];

export const SENDER_MAILBOX_STATUSES = ['active', 'inactive'] as const;
export type SenderMailboxStatus = (typeof SENDER_MAILBOX_STATUSES)[number];

/**
 * One mailbox MarkFlow may send as, under a given sending_domains[] entry.
 * `mailboxAssignment.service.ts`'s assignMailboxForDomain() round-robins sends across every
 * `active` mailbox on an entry; `inactive` keeps a mailbox configured — its own SendGuardrail
 * ramp-up/bounce history in DomainSendEvent stays intact — without new sends currently landing
 * on it, e.g. while it's being re-provisioned, or deliberately retired without losing its audit
 * trail. `display_name` is optional metadata only (e.g. "Alex - SDR"); nothing in DomainRouter or
 * SendGuardrail reads it.
 */
export interface SenderMailboxEntry {
  address: string;
  display_name?: string | null;
  status: SenderMailboxStatus;
}

/**
 * The plain (lean-friendly) shape of one Organization.sending_domains[] entry. DomainRouter
 * always works off `.lean()` results, never a hydrated Organization document, so its functions
 * type against this rather than `OrganizationDocument`'s Mongoose subdocument-array type.
 *
 * `mailboxes` defaults to `[]` for any entry nobody has migrated yet — resolveSendingRoute
 * (domainRouter.service.ts) falls back to the deployment-level DOMAIN_PROVIDER_MAP_JSON's single
 * `mailbox` for that domain whenever this is empty, so an org that hasn't explicitly configured
 * per-domain mailboxes keeps sending exactly as it did before this existed.
 */
export interface SendingDomainEntry {
  domain: string;
  purpose: SendingDomainPurpose;
  mailboxes: SenderMailboxEntry[];
}

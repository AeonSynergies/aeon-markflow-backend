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

/**
 * The plain (lean-friendly) shape of one Organization.sending_domains[] entry. DomainRouter
 * always works off `.lean()` results, never a hydrated Organization document, so its functions
 * type against this rather than `OrganizationDocument`'s Mongoose subdocument-array type.
 */
export interface SendingDomainEntry {
  domain: string;
  purpose: SendingDomainPurpose;
}

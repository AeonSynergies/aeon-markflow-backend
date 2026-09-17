import { getDomainProviderMap } from '../config/domainProviders';
import type { SendingDomainEntry, SendingDomainPurpose } from '../constants/organization';
import type { EmailProvider } from '../emailProviders/EmailProvider';
import { getEmailProvider } from '../emailProviders/providerRegistry';
import { assignMailboxForDomain } from './mailboxAssignment.service';

export class DomainNotAllowedForOrgError extends Error {
  constructor(orgId: string, domain: string, purpose: SendingDomainPurpose) {
    super(`Organization ${orgId} is not configured to send ${purpose} email from domain ${domain}`);
    this.name = 'DomainNotAllowedForOrgError';
  }
}

export class UnroutableDomainError extends Error {
  constructor(domain: string) {
    super(`No provider is configured for sending domain ${domain} (check DOMAIN_PROVIDER_MAP_JSON)`);
    this.name = 'UnroutableDomainError';
  }
}

export interface SendingRoute {
  provider: EmailProvider;
  mailbox: string;
  domain: string;
}

interface OrgForRouting {
  sending_domains: SendingDomainEntry[];
  _id: { toString(): string };
}

/**
 * Looks up the entry an org must have for this exact domain+purpose, and the deployment-level
 * provider mapping for the domain. Shared by resolveSendingRoute and assignMailboxesForDomains
 * so both raise the exact same errors for the exact same misconfiguration.
 */
function requireRoutingConfig(org: OrgForRouting, domain: string, purpose: SendingDomainPurpose) {
  const entry = org.sending_domains.find((candidate) => candidate.domain === domain && candidate.purpose === purpose);
  if (!entry) {
    throw new DomainNotAllowedForOrgError(org._id.toString(), domain, purpose);
  }

  const config = getDomainProviderMap()[domain];
  if (!config) {
    throw new UnroutableDomainError(domain);
  }

  return { entry, config };
}

/**
 * Resolves which EmailProvider + mailbox to send through for a given org + domain + purpose. The
 * domain must both be listed in the org's own sending_domains[] *for that exact purpose* (an org
 * can list domains hosted by more than one provider — e.g. Aeon Miles sending via its own domain
 * *and* via the Aeon Synergies domain, never assume 1:1 org-to-domain) and have a provider
 * mapping in the deployment-level domain registry. Selecting by purpose, not just by domain, is
 * what stops a marketing send from ever going out from — and diluting the reputation of — a
 * transactional or alerts domain: a caller always states which purpose it's sending for, and
 * this rejects a domain that's listed under a different purpose even if the org sends from it.
 *
 * The mailbox itself is `options.assignedMailbox` when the caller already has one — every
 * workflow email send does, from `Enrollment.assigned_mailboxes` (assigned once, at enrollment
 * creation, by assignMailboxesForDomains below; see enrollmentProcessor.ts's sendWorkflowEmail).
 * Left unset, this falls back to resolving one on the spot: that entry's own `mailboxes[]`
 * (round-robinned by mailboxAssignment.service.ts's assignMailboxForDomain) or, when the entry
 * hasn't configured any yet, the deployment-level registry's single default mailbox for that
 * domain. That fallback path exists for any caller that isn't a per-enrollment send — an
 * already-running enrollment created before this option existed has no `assigned_mailboxes` of
 * its own yet, and still needs a mailbox to send through.
 */
export async function resolveSendingRoute(
  org: OrgForRouting,
  domain: string,
  purpose: SendingDomainPurpose,
  options: { assignedMailbox?: string } = {},
): Promise<SendingRoute> {
  const { entry, config } = requireRoutingConfig(org, domain, purpose);

  const mailbox =
    options.assignedMailbox ??
    (entry.mailboxes.length > 0 ? await assignMailboxForDomain(domain, entry.mailboxes) : config.mailbox);

  return { provider: getEmailProvider(config.provider), mailbox, domain };
}

/**
 * Assigns one mailbox per distinct domain, up front — called once, at enrollment creation
 * (enrollment.service.ts's enrollSavedList), not per send. Without this, resolveSendingRoute's
 * own round robin would re-run on every single email step, and a lead's sequence could visibly
 * send from a different named mailbox at every touch instead of one consistent sender across
 * the whole enrollment. The round robin still balances load across a domain's mailboxes — just
 * at the point a new enrollment starts, not on every send within one already running.
 */
export async function assignMailboxesForDomains(
  org: OrgForRouting,
  domains: string[],
  purpose: SendingDomainPurpose,
): Promise<{ domain: string; mailbox: string }[]> {
  const uniqueDomains = [...new Set(domains)];
  return Promise.all(
    uniqueDomains.map(async (domain) => {
      const { entry, config } = requireRoutingConfig(org, domain, purpose);
      const mailbox = entry.mailboxes.length > 0 ? await assignMailboxForDomain(domain, entry.mailboxes) : config.mailbox;
      return { domain, mailbox };
    }),
  );
}

/** This org's domains for a given purpose that also resolve to a configured provider. */
export function routableDomainsForOrg(
  org: { sending_domains: SendingDomainEntry[] },
  purpose: SendingDomainPurpose,
): string[] {
  const map = getDomainProviderMap();
  return org.sending_domains
    .filter((entry) => entry.purpose === purpose && entry.domain in map)
    .map((entry) => entry.domain);
}

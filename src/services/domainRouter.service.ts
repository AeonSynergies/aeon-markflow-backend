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
 * The mailbox itself comes from that entry's own `mailboxes[]` (round-robinned by
 * mailboxAssignment.service.ts's assignMailboxForDomain, so a domain with several configured
 * mailboxes distributes sends — and therefore ramp-up/bounce exposure — across all of them
 * rather than concentrating it on one address) or, when the entry hasn't configured any yet,
 * the deployment-level registry's single default mailbox for that domain.
 */
export async function resolveSendingRoute(
  org: { sending_domains: SendingDomainEntry[]; _id: { toString(): string } },
  domain: string,
  purpose: SendingDomainPurpose,
): Promise<SendingRoute> {
  const entry = org.sending_domains.find((candidate) => candidate.domain === domain && candidate.purpose === purpose);
  if (!entry) {
    throw new DomainNotAllowedForOrgError(org._id.toString(), domain, purpose);
  }

  const config = getDomainProviderMap()[domain];
  if (!config) {
    throw new UnroutableDomainError(domain);
  }

  const mailbox = entry.mailboxes.length > 0 ? await assignMailboxForDomain(domain, entry.mailboxes) : config.mailbox;

  return { provider: getEmailProvider(config.provider), mailbox, domain };
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

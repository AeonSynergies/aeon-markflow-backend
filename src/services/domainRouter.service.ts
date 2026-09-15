import { getDomainProviderMap } from '../config/domainProviders';
import type { SendingDomainEntry, SendingDomainPurpose } from '../constants/organization';
import type { EmailProvider } from '../emailProviders/EmailProvider';
import { getEmailProvider } from '../emailProviders/providerRegistry';

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
 * *and* via the Aeon Synergies domain, never assume 1:1 org-to-domain) and have a provider/mailbox
 * mapping in the deployment-level domain registry. Selecting by purpose, not just by domain, is
 * what stops a marketing send from ever going out from — and diluting the reputation of — a
 * transactional or alerts domain: a caller always states which purpose it's sending for, and
 * this rejects a domain that's listed under a different purpose even if the org sends from it.
 */
export function resolveSendingRoute(
  org: { sending_domains: SendingDomainEntry[]; _id: { toString(): string } },
  domain: string,
  purpose: SendingDomainPurpose,
): SendingRoute {
  const allowed = org.sending_domains.some((entry) => entry.domain === domain && entry.purpose === purpose);
  if (!allowed) {
    throw new DomainNotAllowedForOrgError(org._id.toString(), domain, purpose);
  }

  const config = getDomainProviderMap()[domain];
  if (!config) {
    throw new UnroutableDomainError(domain);
  }

  return { provider: getEmailProvider(config.provider), mailbox: config.mailbox, domain };
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

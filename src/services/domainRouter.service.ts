import { getDomainProviderMap } from '../config/domainProviders';
import type { EmailProvider } from '../emailProviders/EmailProvider';
import { getEmailProvider } from '../emailProviders/providerRegistry';
import type { OrganizationDocument } from '../models/Organization.model';

export class DomainNotAllowedForOrgError extends Error {
  constructor(orgId: string, domain: string) {
    super(`Organization ${orgId} is not configured to send from domain ${domain}`);
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
 * Resolves which EmailProvider + mailbox to send through for a given org + domain. The domain
 * must both be listed in the org's own sending_domains[] (an org can list domains hosted by
 * more than one provider — e.g. Aeon Miles sending via its own domain *and* via the Aeon
 * Synergies domain, never assume 1:1 org-to-domain) and have a provider/mailbox mapping in the
 * deployment-level domain registry.
 */
export function resolveSendingRoute(
  org: Pick<OrganizationDocument, 'sending_domains'> & { _id: { toString(): string } },
  domain: string,
): SendingRoute {
  if (!org.sending_domains.includes(domain)) {
    throw new DomainNotAllowedForOrgError(org._id.toString(), domain);
  }

  const config = getDomainProviderMap()[domain];
  if (!config) {
    throw new UnroutableDomainError(domain);
  }

  return { provider: getEmailProvider(config.provider), mailbox: config.mailbox, domain };
}

/** Domains this org is allowed to send from that also resolve to a configured provider. */
export function routableDomainsForOrg(org: Pick<OrganizationDocument, 'sending_domains'>): string[] {
  const map = getDomainProviderMap();
  return org.sending_domains.filter((domain) => domain in map);
}

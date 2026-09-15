import type { EmailProviderName } from '../emailProviders/types';

export interface DomainProviderConfig {
  provider: EmailProviderName;
  /** The mailbox/address this domain sends and reads as on that provider. */
  mailbox: string;
}

/**
 * Deployment-level registry of which provider (and which mailbox) owns each sending domain —
 * separate from Organization.sending_domains[], which only says which domains an *org* is
 * allowed to send from. A domain can belong to exactly one provider account, but an org can be
 * allowed to send from several domains that each map to a different provider.
 */
export function getDomainProviderMap(): Record<string, DomainProviderConfig> {
  const raw = process.env.DOMAIN_PROVIDER_MAP_JSON;
  if (!raw) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`DOMAIN_PROVIDER_MAP_JSON is not valid JSON: ${(error as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('DOMAIN_PROVIDER_MAP_JSON must be a JSON object of domain -> { provider, mailbox }');
  }

  return parsed as Record<string, DomainProviderConfig>;
}

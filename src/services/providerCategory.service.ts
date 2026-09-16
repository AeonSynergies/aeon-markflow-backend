import { resolveMx } from 'dns/promises';
import {
  CONSUMER_WEBMAIL_DOMAINS,
  PROVIDER_CATEGORY_CACHE_TTL_MS,
  type ProviderCategory,
} from '../constants/providerCategory';
import { RecipientProviderCategory } from '../models/RecipientProviderCategory.model';

/**
 * Classifies a recipient's email domain as consumer webmail or corporate/enterprise, for the
 * "auto" image policy (see imagePolicy.service.ts). Checks the well-known-brands list first
 * (no DNS needed), then a long-lived cache, then falls back to an MX lookup — cached afterward
 * so the same domain is never looked up on every single send.
 */
export async function classifyDomain(rawDomain: string): Promise<ProviderCategory> {
  const domain = rawDomain.toLowerCase().trim();
  if (CONSUMER_WEBMAIL_DOMAINS.has(domain)) return 'consumer';

  const cached = await RecipientProviderCategory.findOne({ domain }).lean();
  if (cached && Date.now() - cached.checked_at.getTime() < PROVIDER_CATEGORY_CACHE_TTL_MS) {
    return cached.category as ProviderCategory;
  }

  let mxHosts: string[] = [];
  try {
    const records = await resolveMx(domain);
    mxHosts = records.map((record) => record.exchange);
  } catch {
    // NXDOMAIN, no MX records, or a transient resolver error — none of these prove the domain
    // is consumer webmail, so it still defaults to corporate below.
  }
  const category: ProviderCategory = 'corporate';

  await RecipientProviderCategory.findOneAndUpdate(
    { domain },
    { domain, category, mx_hosts: mxHosts, checked_at: new Date() },
    { upsert: true },
  );

  return category;
}

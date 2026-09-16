import { Types } from 'mongoose';

jest.mock('../../src/emailProviders/providerRegistry', () => ({
  getEmailProvider: jest.fn((name: string) => ({ name })),
}));
jest.mock('../../src/services/mailboxAssignment.service', () => ({ assignMailboxForDomain: jest.fn() }));

import { getEmailProvider } from '../../src/emailProviders/providerRegistry';
import { assignMailboxForDomain } from '../../src/services/mailboxAssignment.service';
import {
  DomainNotAllowedForOrgError,
  resolveSendingRoute,
  routableDomainsForOrg,
  UnroutableDomainError,
} from '../../src/services/domainRouter.service';

interface OrgSendingDomain {
  domain: string;
  purpose: 'marketing' | 'transactional' | 'alerts';
  mailboxes?: { address: string; display_name: string | null; status: 'active' | 'inactive' }[];
}

function org(sending_domains: OrgSendingDomain[]) {
  return {
    _id: new Types.ObjectId(),
    sending_domains: sending_domains.map((entry) => ({ mailboxes: [], ...entry })),
  };
}

describe('domainRouter.service', () => {
  const originalMap = process.env.DOMAIN_PROVIDER_MAP_JSON;

  afterEach(() => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = originalMap;
    jest.clearAllMocks();
  });

  it('resolves the provider and falls back to the deployment-map mailbox when no org mailboxes are configured', async () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({
      'aeonmiles.com': { provider: 'google_workspace', mailbox: 'sales@aeonmiles.com' },
      'aeonsynergies.com': { provider: 'microsoft_graph', mailbox: 'sales@aeonsynergies.com' },
    });

    // Aeon Miles can send from its own domain AND the Aeon Synergies domain — never 1:1.
    const route = await resolveSendingRoute(
      org([
        { domain: 'aeonmiles.com', purpose: 'marketing' },
        { domain: 'aeonsynergies.com', purpose: 'marketing' },
      ]),
      'aeonsynergies.com',
      'marketing',
    );

    expect(getEmailProvider).toHaveBeenCalledWith('microsoft_graph');
    expect(route).toEqual({
      provider: { name: 'microsoft_graph' },
      mailbox: 'sales@aeonsynergies.com',
      domain: 'aeonsynergies.com',
    });
    expect(assignMailboxForDomain).not.toHaveBeenCalled();
  });

  it('round-robins across the entry\'s own configured mailboxes when any are present', async () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({
      'aeonsynergies.com': { provider: 'microsoft_graph', mailbox: 'fallback@aeonsynergies.com' },
    });
    const mailboxes = [
      { address: 'alex@aeonsynergies.com', display_name: null, status: 'active' as const },
      { address: 'jordan@aeonsynergies.com', display_name: null, status: 'active' as const },
    ];
    (assignMailboxForDomain as jest.Mock).mockResolvedValue('jordan@aeonsynergies.com');

    const route = await resolveSendingRoute(
      org([{ domain: 'aeonsynergies.com', purpose: 'marketing', mailboxes }]),
      'aeonsynergies.com',
      'marketing',
    );

    expect(assignMailboxForDomain).toHaveBeenCalledWith('aeonsynergies.com', mailboxes);
    expect(route.mailbox).toBe('jordan@aeonsynergies.com');
  });

  it('rejects a domain the org is not configured to send from', async () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({
      'aeonmiles.com': { provider: 'google_workspace', mailbox: 'sales@aeonmiles.com' },
    });

    await expect(
      resolveSendingRoute(org([{ domain: 'aeonmiles.com', purpose: 'marketing' }]), 'aeonsign.com', 'marketing'),
    ).rejects.toThrow(DomainNotAllowedForOrgError);
    expect(getEmailProvider).not.toHaveBeenCalled();
  });

  it('rejects a domain the org lists, but only for a different purpose', async () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({
      'aeonsynergies.com': { provider: 'microsoft_graph', mailbox: 'sales@aeonsynergies.com' },
    });

    await expect(
      resolveSendingRoute(
        org([{ domain: 'aeonsynergies.com', purpose: 'transactional' }]),
        'aeonsynergies.com',
        'marketing',
      ),
    ).rejects.toThrow(DomainNotAllowedForOrgError);
    expect(getEmailProvider).not.toHaveBeenCalled();
  });

  it('rejects a domain with no provider mapping even if the org lists it', async () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({});

    await expect(
      resolveSendingRoute(org([{ domain: 'aeonmiles.com', purpose: 'marketing' }]), 'aeonmiles.com', 'marketing'),
    ).rejects.toThrow(UnroutableDomainError);
  });

  it('throws a clear error when DOMAIN_PROVIDER_MAP_JSON is malformed', async () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = '{not json';
    await expect(
      resolveSendingRoute(org([{ domain: 'aeonmiles.com', purpose: 'marketing' }]), 'aeonmiles.com', 'marketing'),
    ).rejects.toThrow('not valid JSON');
  });

  it('filters routableDomainsForOrg to domains that are allowed for that purpose and mapped', () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({
      'aeonmiles.com': { provider: 'google_workspace', mailbox: 'sales@aeonmiles.com' },
      'aeonsign.com': { provider: 'zoho_mail', mailbox: 'sales@aeonsign.com' },
    });

    const domains = routableDomainsForOrg(
      org([
        { domain: 'aeonmiles.com', purpose: 'marketing' },
        { domain: 'aeonsign.com', purpose: 'transactional' },
      ]),
      'marketing',
    );
    expect(domains).toEqual(['aeonmiles.com']);
  });
});

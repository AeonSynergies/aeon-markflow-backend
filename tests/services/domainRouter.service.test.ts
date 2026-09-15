import { Types } from 'mongoose';

jest.mock('../../src/emailProviders/providerRegistry', () => ({
  getEmailProvider: jest.fn((name: string) => ({ name })),
}));

import { getEmailProvider } from '../../src/emailProviders/providerRegistry';
import {
  DomainNotAllowedForOrgError,
  resolveSendingRoute,
  routableDomainsForOrg,
  UnroutableDomainError,
} from '../../src/services/domainRouter.service';

function org(sending_domains: string[]) {
  return { _id: new Types.ObjectId(), sending_domains };
}

describe('domainRouter.service', () => {
  const originalMap = process.env.DOMAIN_PROVIDER_MAP_JSON;

  afterEach(() => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = originalMap;
    jest.clearAllMocks();
  });

  it('resolves the provider and mailbox for a domain the org may send from', () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({
      'aeonmiles.com': { provider: 'google_workspace', mailbox: 'sales@aeonmiles.com' },
      'aeonsynergies.com': { provider: 'microsoft_graph', mailbox: 'sales@aeonsynergies.com' },
    });

    // Aeon Miles can send from its own domain AND the Aeon Synergies domain — never 1:1.
    const route = resolveSendingRoute(org(['aeonmiles.com', 'aeonsynergies.com']), 'aeonsynergies.com');

    expect(getEmailProvider).toHaveBeenCalledWith('microsoft_graph');
    expect(route).toEqual({
      provider: { name: 'microsoft_graph' },
      mailbox: 'sales@aeonsynergies.com',
      domain: 'aeonsynergies.com',
    });
  });

  it('rejects a domain the org is not configured to send from', () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({
      'aeonmiles.com': { provider: 'google_workspace', mailbox: 'sales@aeonmiles.com' },
    });

    expect(() => resolveSendingRoute(org(['aeonmiles.com']), 'aeonsign.com')).toThrow(
      DomainNotAllowedForOrgError,
    );
    expect(getEmailProvider).not.toHaveBeenCalled();
  });

  it('rejects a domain with no provider mapping even if the org lists it', () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({});

    expect(() => resolveSendingRoute(org(['aeonmiles.com']), 'aeonmiles.com')).toThrow(
      UnroutableDomainError,
    );
  });

  it('throws a clear error when DOMAIN_PROVIDER_MAP_JSON is malformed', () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = '{not json';
    expect(() => resolveSendingRoute(org(['aeonmiles.com']), 'aeonmiles.com')).toThrow('not valid JSON');
  });

  it('filters routableDomainsForOrg to domains that are both allowed and mapped', () => {
    process.env.DOMAIN_PROVIDER_MAP_JSON = JSON.stringify({
      'aeonmiles.com': { provider: 'google_workspace', mailbox: 'sales@aeonmiles.com' },
    });

    const domains = routableDomainsForOrg(org(['aeonmiles.com', 'aeonsign.com']));
    expect(domains).toEqual(['aeonmiles.com']);
  });
});

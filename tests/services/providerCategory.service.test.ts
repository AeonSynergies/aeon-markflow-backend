jest.mock('dns/promises', () => ({ resolveMx: jest.fn() }));
jest.mock('../../src/models/RecipientProviderCategory.model', () => ({
  RecipientProviderCategory: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

import { resolveMx } from 'dns/promises';
import { RecipientProviderCategory } from '../../src/models/RecipientProviderCategory.model';
import { classifyDomain } from '../../src/services/providerCategory.service';

describe('providerCategory.service classifyDomain', () => {
  afterEach(() => jest.clearAllMocks());

  it('classifies a well-known consumer webmail domain without any DNS lookup or cache hit', async () => {
    const result = await classifyDomain('gmail.com');

    expect(result).toBe('consumer');
    expect(resolveMx).not.toHaveBeenCalled();
    expect(RecipientProviderCategory.findOne).not.toHaveBeenCalled();
  });

  it('is case/whitespace-insensitive for the well-known list', async () => {
    const result = await classifyDomain('  GMAIL.com ');
    expect(result).toBe('consumer');
  });

  it('returns a fresh cached classification without a new DNS lookup', async () => {
    (RecipientProviderCategory.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ category: 'corporate', checked_at: new Date() }),
    });

    const result = await classifyDomain('acme.com');

    expect(result).toBe('corporate');
    expect(resolveMx).not.toHaveBeenCalled();
  });

  it('re-resolves and refreshes the cache once it has expired', async () => {
    const stale = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    (RecipientProviderCategory.findOne as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ category: 'corporate', checked_at: stale }),
    });
    (resolveMx as jest.Mock).mockResolvedValue([{ exchange: 'mx1.acme.com', priority: 10 }]);

    const result = await classifyDomain('acme.com');

    expect(result).toBe('corporate');
    expect(resolveMx).toHaveBeenCalledWith('acme.com');
    expect(RecipientProviderCategory.findOneAndUpdate).toHaveBeenCalledWith(
      { domain: 'acme.com' },
      expect.objectContaining({ domain: 'acme.com', category: 'corporate', mx_hosts: ['mx1.acme.com'] }),
      { upsert: true },
    );
  });

  it('looks up and caches a domain with no prior cache entry', async () => {
    (RecipientProviderCategory.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    (resolveMx as jest.Mock).mockResolvedValue([{ exchange: 'aspmx.l.google.com', priority: 1 }]);

    const result = await classifyDomain('mybusiness.com');

    expect(result).toBe('corporate');
    expect(RecipientProviderCategory.findOneAndUpdate).toHaveBeenCalledWith(
      { domain: 'mybusiness.com' },
      expect.objectContaining({ category: 'corporate', mx_hosts: ['aspmx.l.google.com'] }),
      { upsert: true },
    );
  });

  it('defaults to corporate and still caches when the MX lookup fails outright', async () => {
    (RecipientProviderCategory.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    (resolveMx as jest.Mock).mockRejectedValue(new Error('ENOTFOUND'));

    const result = await classifyDomain('doesnotexist.invalid');

    expect(result).toBe('corporate');
    expect(RecipientProviderCategory.findOneAndUpdate).toHaveBeenCalledWith(
      { domain: 'doesnotexist.invalid' },
      expect.objectContaining({ category: 'corporate', mx_hosts: [] }),
      { upsert: true },
    );
  });
});

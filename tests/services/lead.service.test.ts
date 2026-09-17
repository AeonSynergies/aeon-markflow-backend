jest.mock('../../src/models/Lead.model', () => ({ Lead: { find: jest.fn(), findOne: jest.fn() } }));
jest.mock('../../src/models/Contact.model', () => ({ Contact: { find: jest.fn(), findById: jest.fn() } }));

import { Contact } from '../../src/models/Contact.model';
import { Lead } from '../../src/models/Lead.model';
import { getLeadForOrg, listLeadsForOrg } from '../../src/services/lead.service';

function sortLean(value: unknown) {
  return { sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('lead.service listLeadsForOrg', () => {
  afterEach(() => jest.clearAllMocks());

  it('queries by org alone and enriches from the shared Contact when no filters are given', async () => {
    (Lead.find as jest.Mock).mockReturnValue(
      sortLean([
        {
          _id: { toString: () => 'lead-1' },
          org_id: { toString: () => 'org-1' },
          contact_id: { toString: () => 'contact-1' },
          status: 'NEW-COLD',
          email_deliverability: 'GOOD',
          phone_dnd_status: false,
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ]),
    );
    (Contact.find as jest.Mock).mockReturnValue(
      lean([{ _id: { toString: () => 'contact-1' }, name: 'Jane Doe', company: 'Acme DSP', email: 'jane@acme.com', phone: '+1555' }]),
    );

    const leads = await listLeadsForOrg('org-1');

    expect(Lead.find).toHaveBeenCalledWith({ org_id: 'org-1' });
    expect(leads).toEqual([
      expect.objectContaining({
        leadId: 'lead-1',
        orgId: 'org-1',
        contactId: 'contact-1',
        name: 'Jane Doe',
        company: 'Acme DSP',
        email: 'jane@acme.com',
        phone: '+1555',
        status: 'NEW-COLD',
      }),
    ]);
  });

  it('filters by status', async () => {
    (Lead.find as jest.Mock).mockReturnValue(sortLean([]));

    await listLeadsForOrg('org-1', { status: 'PROSPECT' });

    expect(Lead.find).toHaveBeenCalledWith({ org_id: 'org-1', status: 'PROSPECT' });
  });

  it('the recycled segment filter forces status RECLAIMED or DISCOVERY_RETRY regardless of any status filter given', async () => {
    (Lead.find as jest.Mock).mockReturnValue(sortLean([]));

    await listLeadsForOrg('org-1', { status: 'PROSPECT', recycledSegment: true });

    expect(Lead.find).toHaveBeenCalledWith({ org_id: 'org-1', status: { $in: ['RECLAIMED', 'DISCOVERY_RETRY'] } });
  });

  it('surfaces lost_reason/lost_stage in the response for a recycled lead', async () => {
    (Lead.find as jest.Mock).mockReturnValue(
      sortLean([
        {
          _id: { toString: () => 'lead-1' },
          org_id: { toString: () => 'org-1' },
          contact_id: { toString: () => 'contact-1' },
          status: 'RECLAIMED',
          email_deliverability: 'GOOD',
          phone_dnd_status: false,
          lost_reason: 'price',
          lost_stage: 'discovery',
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ]),
    );
    (Contact.find as jest.Mock).mockReturnValue(lean([]));

    const [lead] = await listLeadsForOrg('org-1', { recycledSegment: true });

    expect(lead.lostReason).toBe('price');
    expect(lead.lostStage).toBe('discovery');
  });

  it('searches by resolving matching Contact ids first, then scoping Lead to this org', async () => {
    (Contact.find as jest.Mock).mockReturnValueOnce(lean([{ _id: { toString: () => 'contact-1' } }]));
    (Lead.find as jest.Mock).mockReturnValue(sortLean([]));

    await listLeadsForOrg('org-1', { search: 'acme' });

    expect(Contact.find).toHaveBeenCalledWith(
      { $or: [{ name: expect.any(RegExp) }, { company: expect.any(RegExp) }] },
      '_id',
    );
    expect(Lead.find).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'org-1', contact_id: { $in: [expect.objectContaining({ toString: expect.any(Function) })] } }),
    );
  });

  it('short-circuits to an empty array when the search matches no Contact at all', async () => {
    (Contact.find as jest.Mock).mockReturnValueOnce(lean([]));

    const leads = await listLeadsForOrg('org-1', { search: 'nobody' });

    expect(leads).toEqual([]);
    expect(Lead.find).not.toHaveBeenCalled();
  });

  it('returns an empty array without querying Contact again when there are no matching leads', async () => {
    (Lead.find as jest.Mock).mockReturnValue(sortLean([]));

    const leads = await listLeadsForOrg('org-1');

    expect(leads).toEqual([]);
    expect(Contact.find).not.toHaveBeenCalled();
  });

  describe('getLeadForOrg', () => {
    it('returns the enriched lead when it belongs to the org', async () => {
      (Lead.findOne as jest.Mock).mockReturnValue(
        lean({
          _id: { toString: () => 'lead-1' },
          org_id: { toString: () => 'org-1' },
          contact_id: { toString: () => 'contact-1' },
          status: 'DISCOVERY_RETRY',
          email_deliverability: 'GOOD',
          phone_dnd_status: false,
          lost_reason: 'no_show',
          lost_stage: 'discovery',
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        }),
      );
      (Contact.findById as jest.Mock).mockReturnValue(
        lean({ _id: { toString: () => 'contact-1' }, name: 'Jane Doe', company: 'Acme DSP' }),
      );

      const lead = await getLeadForOrg('org-1', 'lead-1');

      expect(Lead.findOne).toHaveBeenCalledWith({ _id: 'lead-1', org_id: 'org-1' });
      expect(lead).toEqual(
        expect.objectContaining({ leadId: 'lead-1', status: 'DISCOVERY_RETRY', name: 'Jane Doe', lostReason: 'no_show' }),
      );
    });

    it('returns null when no lead matches the org', async () => {
      (Lead.findOne as jest.Mock).mockReturnValue(lean(null));

      const lead = await getLeadForOrg('org-1', 'lead-1');

      expect(lead).toBeNull();
      expect(Contact.findById).not.toHaveBeenCalled();
    });
  });
});

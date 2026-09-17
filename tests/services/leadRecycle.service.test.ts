jest.mock('../../src/models/Lead.model', () => ({
  Lead: { findOne: jest.fn(), updateMany: jest.fn() },
}));

import { Types } from 'mongoose';
import { Lead } from '../../src/models/Lead.model';
import { LeadNotFoundError, graduateStaleDiscoveryRetryLeads, recycleLead } from '../../src/services/leadRecycle.service';

function mockLead(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: 'lead-1',
    status: 'PROSPECT',
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  (Lead.findOne as jest.Mock).mockResolvedValue(doc);
  return doc;
}

describe('leadRecycle.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('recycleLead', () => {
    it('throws LeadNotFoundError when the lead does not belong to the org (or does not exist)', async () => {
      (Lead.findOne as jest.Mock).mockResolvedValue(null);

      await expect(recycleLead('org-1', 'lead-1', { dealId: 'deal-1', lostReason: 'price', lostStage: 'discovery' })).rejects.toThrow(
        LeadNotFoundError,
      );
      expect(Lead.findOne).toHaveBeenCalledWith({ _id: 'lead-1', org_id: 'org-1' });
    });

    it('routes an ordinary lost_reason to RECLAIMED, with no discovery_retry_started_at', async () => {
      const lead = mockLead();
      const dealId = new Types.ObjectId().toString();

      const result = await recycleLead('org-1', 'lead-1', {
        dealId,
        lostReason: 'price',
        lostStage: 'negotiation',
      });

      expect(result.status).toBe('RECLAIMED');
      expect(lead.lost_reason).toBe('price');
      expect(lead.lost_stage).toBe('negotiation');
      expect(lead.discovery_retry_started_at).toBeNull();
      expect((lead.recycled_from_deal_id as Types.ObjectId).toString()).toBe(dealId);
      expect(lead.save).toHaveBeenCalled();
    });

    it.each(['no_show', 'cancelled_discovery'])(
      'routes lost_reason %s to DISCOVERY_RETRY, setting discovery_retry_started_at',
      async (lostReason) => {
        const lead = mockLead();

        const result = await recycleLead('org-1', 'lead-1', {
          dealId: new Types.ObjectId().toString(),
          lostReason,
          lostStage: 'discovery',
        });

        expect(result.status).toBe('DISCOVERY_RETRY');
        expect(lead.discovery_retry_started_at).toBeInstanceOf(Date);
      },
    );

    it('defaults eligible_for_reengagement_at to null when not given', async () => {
      const lead = mockLead();

      await recycleLead('org-1', 'lead-1', { dealId: new Types.ObjectId().toString(), lostReason: 'price', lostStage: 'discovery' });

      expect(lead.eligible_for_reengagement_at).toBeNull();
    });

    it('passes through an explicit eligible_for_reengagement_at', async () => {
      const lead = mockLead();
      const date = new Date('2026-06-01');

      await recycleLead('org-1', 'lead-1', {
        dealId: new Types.ObjectId().toString(),
        lostReason: 'price',
        lostStage: 'discovery',
        eligibleForReengagementAt: date,
      });

      expect(lead.eligible_for_reengagement_at).toBe(date);
    });
  });

  describe('graduateStaleDiscoveryRetryLeads', () => {
    it('updates every DISCOVERY_RETRY lead past the graduation cutoff to RECLAIMED', async () => {
      (Lead.updateMany as jest.Mock).mockResolvedValue({ modifiedCount: 3 });

      const count = await graduateStaleDiscoveryRetryLeads();

      expect(Lead.updateMany).toHaveBeenCalledWith(
        { status: 'DISCOVERY_RETRY', discovery_retry_started_at: { $lte: expect.any(Date) } },
        { status: 'RECLAIMED', discovery_retry_started_at: null },
      );
      expect(count).toBe(3);
    });
  });
});

jest.mock('../../src/models/LeadActivity.model', () => ({ LeadActivity: { find: jest.fn() } }));

import { LeadActivity } from '../../src/models/LeadActivity.model';
import { getLeadEmailThread } from '../../src/services/leadThread.service';

describe('leadThread.service', () => {
  afterEach(() => jest.clearAllMocks());

  it('queries only email-kind activity for the lead, oldest first', async () => {
    const sort = jest.fn().mockReturnThis();
    const limit = jest.fn().mockReturnThis();
    const lean = jest.fn().mockResolvedValue([]);
    (LeadActivity.find as jest.Mock).mockReturnValue({ sort, limit, lean });

    await getLeadEmailThread('lead-1', 10);

    expect(LeadActivity.find).toHaveBeenCalledWith({ lead_id: 'lead-1', kind: 'email' });
    expect(sort).toHaveBeenCalledWith({ occurred_at: 1 });
    expect(limit).toHaveBeenCalledWith(10);
  });

  it('maps activities to thread messages, falling back to body_html when body_text is absent', async () => {
    const occurredAt = new Date('2026-01-01T00:00:00.000Z');
    (LeadActivity.find as jest.Mock).mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockResolvedValue([
        { direction: 'inbound', subject: 'Re: hi', body_text: 'plain reply', occurred_at: occurredAt },
        { direction: 'outbound', subject: 'hi', body_html: '<p>html body</p>', occurred_at: occurredAt },
      ]),
    });

    const thread = await getLeadEmailThread('lead-1');

    expect(thread).toEqual([
      { direction: 'inbound', subject: 'Re: hi', bodyText: 'plain reply', occurredAt },
      { direction: 'outbound', subject: 'hi', bodyText: '<p>html body</p>', occurredAt },
    ]);
  });
});

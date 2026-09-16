jest.mock('../../src/models/DomainSendEvent.model', () => ({ DomainSendEvent: { aggregate: jest.fn() } }));

import { DomainSendEvent } from '../../src/models/DomainSendEvent.model';
import { assignMailboxForDomain, NoActiveMailboxError } from '../../src/services/mailboxAssignment.service';

function mailbox(address: string, status: 'active' | 'inactive' = 'active') {
  return { address, display_name: null, status };
}

describe('mailboxAssignment.service', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws when no mailbox on the entry is active', async () => {
    await expect(assignMailboxForDomain('x.com', [mailbox('a@x.com', 'inactive')])).rejects.toThrow(
      NoActiveMailboxError,
    );
    expect(DomainSendEvent.aggregate).not.toHaveBeenCalled();
  });

  it('returns the sole active mailbox without querying send history', async () => {
    const result = await assignMailboxForDomain('x.com', [mailbox('a@x.com', 'inactive'), mailbox('b@x.com')]);
    expect(result).toBe('b@x.com');
    expect(DomainSendEvent.aggregate).not.toHaveBeenCalled();
  });

  it('picks the active mailbox with the fewest all-time sends', async () => {
    (DomainSendEvent.aggregate as jest.Mock).mockResolvedValue([
      { _id: 'a@x.com', count: 40 },
      { _id: 'b@x.com', count: 12 },
    ]);

    const result = await assignMailboxForDomain('x.com', [mailbox('a@x.com'), mailbox('b@x.com')]);

    expect(result).toBe('b@x.com');
    expect(DomainSendEvent.aggregate).toHaveBeenCalledWith([
      { $match: { domain: 'x.com', kind: 'sent', mailbox: { $in: ['a@x.com', 'b@x.com'] } } },
      { $group: { _id: '$mailbox', count: { $sum: 1 } } },
    ]);
  });

  it('a brand-new mailbox with zero sends is picked over an established one', async () => {
    (DomainSendEvent.aggregate as jest.Mock).mockResolvedValue([{ _id: 'established@x.com', count: 500 }]);

    const result = await assignMailboxForDomain('x.com', [mailbox('established@x.com'), mailbox('new@x.com')]);

    expect(result).toBe('new@x.com');
  });

  it('never considers an inactive mailbox even if it has the fewest sends', async () => {
    (DomainSendEvent.aggregate as jest.Mock).mockResolvedValue([
      { _id: 'a@x.com', count: 40 },
      { _id: 'b@x.com', count: 0 },
    ]);

    const result = await assignMailboxForDomain('x.com', [mailbox('a@x.com'), mailbox('b@x.com', 'inactive')]);

    expect(result).toBe('a@x.com');
  });

  it('breaks a tie (including every mailbox at zero sends) on configured order', async () => {
    (DomainSendEvent.aggregate as jest.Mock).mockResolvedValue([]);

    const result = await assignMailboxForDomain('x.com', [mailbox('first@x.com'), mailbox('second@x.com')]);

    expect(result).toBe('first@x.com');
  });
});

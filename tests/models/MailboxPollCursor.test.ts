import { MailboxPollCursor } from '../../src/models/MailboxPollCursor.model';

describe('MailboxPollCursor model', () => {
  it('requires mailbox, domain, and last_polled_at', () => {
    const doc = new MailboxPollCursor({});
    const err = doc.validateSync();
    expect(err?.errors.mailbox).toBeDefined();
    expect(err?.errors.domain).toBeDefined();
    expect(err?.errors.last_polled_at).toBeDefined();
  });

  it('validates a full cursor', () => {
    const doc = new MailboxPollCursor({
      mailbox: 'sales@aeonsign.com',
      domain: 'aeonsign.com',
      last_polled_at: new Date(),
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('enforces one cursor per mailbox via a unique index', () => {
    const indexes = MailboxPollCursor.schema.indexes();
    const mailboxIndex = indexes.find(([fields]) => fields.mailbox === 1);
    expect(mailboxIndex?.[1].unique).toBe(true);
  });
});

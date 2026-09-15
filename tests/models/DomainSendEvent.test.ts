import { Types } from 'mongoose';
import { DomainSendEvent } from '../../src/models/DomainSendEvent.model';

describe('DomainSendEvent model', () => {
  it('requires domain, mailbox, org_id, and kind', () => {
    const doc = new DomainSendEvent({});
    const err = doc.validateSync();
    expect(err?.errors.domain).toBeDefined();
    expect(err?.errors.mailbox).toBeDefined();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.kind).toBeDefined();
  });

  it('accepts a valid sent event with lead_id/enrollment_id defaulting to null', () => {
    const doc = new DomainSendEvent({
      domain: 'aeonsign.com',
      mailbox: 'sales@aeonsign.com',
      org_id: new Types.ObjectId(),
      kind: 'sent',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.lead_id).toBeNull();
    expect(doc.enrollment_id).toBeNull();
  });

  it('rejects an unknown kind', () => {
    const doc = new DomainSendEvent({
      domain: 'aeonsign.com',
      mailbox: 'sales@aeonsign.com',
      org_id: new Types.ObjectId(),
      kind: 'opened',
    });
    expect(doc.validateSync()?.errors.kind).toBeDefined();
  });

  it.each(['sent', 'bounced', 'complained', 'replied'])('accepts kind %s', (kind) => {
    const doc = new DomainSendEvent({
      domain: 'aeonsign.com',
      mailbox: 'sales@aeonsign.com',
      org_id: new Types.ObjectId(),
      kind,
    });
    expect(doc.validateSync()).toBeUndefined();
  });
});

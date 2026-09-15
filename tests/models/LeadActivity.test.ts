import { Types } from 'mongoose';
import { LeadActivity } from '../../src/models/LeadActivity.model';

describe('LeadActivity model', () => {
  it('requires lead_id and kind', () => {
    const doc = new LeadActivity({});
    const err = doc.validateSync();
    expect(err?.errors.lead_id).toBeDefined();
    expect(err?.errors.kind).toBeDefined();
  });

  it('rejects an unknown kind', () => {
    const doc = new LeadActivity({ lead_id: new Types.ObjectId(), kind: 'fax' });
    expect(doc.validateSync()?.errors.kind).toBeDefined();
  });

  it('defaults occurred_at to now and enrollment fields to null', () => {
    const doc = new LeadActivity({ lead_id: new Types.ObjectId(), kind: 'email' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.occurred_at).toBeInstanceOf(Date);
    expect(doc.enrollment_id).toBeNull();
    expect(doc.workflow_step_index).toBeNull();
  });

  it('accepts a full email activity record', () => {
    const doc = new LeadActivity({
      lead_id: new Types.ObjectId(),
      kind: 'email',
      direction: 'inbound',
      subject: 'Re: A simpler way to manage hiring documents',
      body_text: 'Sounds interesting, tell me more.',
      provider_message_id: 'graph-msg-123',
    });
    expect(doc.validateSync()).toBeUndefined();
  });
});

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
      provider_thread_id: 'graph-thread-456',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.provider_thread_id).toBe('graph-thread-456');
  });

  it('indexes provider_thread_id for the mailbox poller\'s thread-based correlation', () => {
    const indexes = LeadActivity.schema.indexes();
    const threadIndex = indexes.find(([fields]) => fields.provider_thread_id === 1);
    expect(threadIndex).toBeDefined();
  });

  it('indexes (provider_message_id, direction) for the mailbox poller\'s idempotency check', () => {
    const indexes = LeadActivity.schema.indexes();
    const dedupeIndex = indexes.find(
      ([fields]) => fields.provider_message_id === 1 && fields.direction === 1,
    );
    expect(dedupeIndex).toBeDefined();
  });

  it('leaves ai_reply_classification undefined by default', () => {
    const doc = new LeadActivity({ lead_id: new Types.ObjectId(), kind: 'email' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.ai_reply_classification).toBeUndefined();
  });

  it('accepts an inbound reply with an AI reply classification', () => {
    const doc = new LeadActivity({
      lead_id: new Types.ObjectId(),
      kind: 'email',
      direction: 'inbound',
      ai_reply_classification: {
        intent: 'interested',
        confidence: 0.9,
        reasoning: 'Explicitly asked to book a call',
        model: 'claude-opus-5',
        classified_at: new Date(),
      },
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.ai_reply_classification).toMatchObject({ intent: 'interested', confidence: 0.9 });
  });

  it('rejects an unknown ai_reply_classification.intent', () => {
    const doc = new LeadActivity({
      lead_id: new Types.ObjectId(),
      kind: 'email',
      ai_reply_classification: {
        intent: 'spam',
        confidence: 0.9,
        reasoning: 'x',
        model: 'claude-opus-5',
        classified_at: new Date(),
      },
    });
    expect(doc.validateSync()?.errors['ai_reply_classification.intent']).toBeDefined();
  });

  it('rejects a confidence outside [0, 1]', () => {
    const doc = new LeadActivity({
      lead_id: new Types.ObjectId(),
      kind: 'email',
      ai_reply_classification: {
        intent: 'unclear',
        confidence: 1.5,
        reasoning: 'x',
        model: 'claude-opus-5',
        classified_at: new Date(),
      },
    });
    expect(doc.validateSync()?.errors['ai_reply_classification.confidence']).toBeDefined();
  });
});

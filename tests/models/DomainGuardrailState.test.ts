import { DomainGuardrailState } from '../../src/models/DomainGuardrailState.model';

describe('DomainGuardrailState model', () => {
  it('requires domain and mailbox', () => {
    const doc = new DomainGuardrailState({});
    const err = doc.validateSync();
    expect(err?.errors.domain).toBeDefined();
    expect(err?.errors.mailbox).toBeDefined();
  });

  it('defaults status to active and pause/resume fields to null', () => {
    const doc = new DomainGuardrailState({ domain: 'aeonsign.com', mailbox: 'sales@aeonsign.com' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('active');
    expect(doc.paused_at).toBeNull();
    expect(doc.review_task_id).toBeNull();
    expect(doc.resumed_at).toBeNull();
    expect(doc.resumed_by).toBeNull();
  });

  it('rejects an unknown status', () => {
    const doc = new DomainGuardrailState({
      domain: 'aeonsign.com',
      mailbox: 'sales@aeonsign.com',
      status: 'suspended',
    });
    expect(doc.validateSync()?.errors.status).toBeDefined();
  });

  it('enforces one state document per (domain, mailbox) pair via a unique compound index', () => {
    const indexes = DomainGuardrailState.schema.indexes();
    const compoundIndex = indexes.find(([fields]) => fields.domain === 1 && fields.mailbox === 1);
    expect(compoundIndex?.[1].unique).toBe(true);
  });
});

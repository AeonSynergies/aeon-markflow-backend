import { Types } from 'mongoose';
import { ReviewTask } from '../../src/models/ReviewTask.model';

describe('ReviewTask model', () => {
  it('requires org_id and email_template_version_id', () => {
    const doc = new ReviewTask({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.email_template_version_id).toBeDefined();
  });

  it('defaults status to OPEN and reviewer fields to null', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      email_template_version_id: new Types.ObjectId(),
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('OPEN');
    expect(doc.reviewed_by).toBeNull();
    expect(doc.reviewed_at).toBeNull();
  });

  it('rejects an unknown status', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      email_template_version_id: new Types.ObjectId(),
      status: 'IN_PROGRESS',
    });
    expect(doc.validateSync()?.errors.status).toBeDefined();
  });

  it('defaults kind to email_template_version', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      email_template_version_id: new Types.ObjectId(),
    });
    expect(doc.kind).toBe('email_template_version');
  });

  it('requires domain (not email_template_version_id) when kind is domain_guardrail', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      kind: 'domain_guardrail',
    });
    const err = doc.validateSync();
    expect(err?.errors.domain).toBeDefined();
    expect(err?.errors.email_template_version_id).toBeUndefined();
  });

  it('validates a domain_guardrail review task with a domain set', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      kind: 'domain_guardrail',
      domain: 'aeonsign.com',
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('requires email_template_version_id (not domain) when kind is email_version_deliverability', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      kind: 'email_version_deliverability',
    });
    const err = doc.validateSync();
    expect(err?.errors.email_template_version_id).toBeDefined();
    expect(err?.errors.domain).toBeUndefined();
  });

  it('validates an email_version_deliverability review task with a version set', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      kind: 'email_version_deliverability',
      email_template_version_id: new Types.ObjectId(),
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('requires send_time_recommendation_id (not email_template_version_id) when kind is send_time_recommendation', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      kind: 'send_time_recommendation',
    });
    const err = doc.validateSync();
    expect(err?.errors.send_time_recommendation_id).toBeDefined();
    expect(err?.errors.email_template_version_id).toBeUndefined();
  });

  it('validates a send_time_recommendation review task with a recommendation set', () => {
    const doc = new ReviewTask({
      org_id: new Types.ObjectId(),
      kind: 'send_time_recommendation',
      send_time_recommendation_id: new Types.ObjectId(),
    });
    expect(doc.validateSync()).toBeUndefined();
  });
});

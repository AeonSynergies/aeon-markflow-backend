import { Types } from 'mongoose';
import { SendTimeRecommendation } from '../../src/models/SendTimeRecommendation.model';

function validMetrics() {
  return { sent_count: 40, reply_rate: 0.1, meeting_rate: 0.02, sample_size: 40 };
}

function validDoc(overrides: Record<string, unknown> = {}) {
  return new SendTimeRecommendation({
    org_id: new Types.ObjectId(),
    day_of_week: 3,
    hour_bucket: 9,
    timezone_bucket: 'America/New_York',
    content_variant_id: new Types.ObjectId(),
    metrics: validMetrics(),
    reason: 'Best-performing combination found so far.',
    generation_source: 'ai_suggested',
    ...overrides,
  });
}

describe('SendTimeRecommendation model', () => {
  it('requires org_id, day_of_week, hour_bucket, timezone_bucket, content_variant_id, metrics, reason, and generation_source', () => {
    const doc = new SendTimeRecommendation({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.day_of_week).toBeDefined();
    expect(err?.errors.hour_bucket).toBeDefined();
    expect(err?.errors.timezone_bucket).toBeDefined();
    expect(err?.errors.content_variant_id).toBeDefined();
    expect(err?.errors.metrics).toBeDefined();
    expect(err?.errors.reason).toBeDefined();
    expect(err?.errors.generation_source).toBeDefined();
  });

  it('defaults status to OPEN and reviewer fields to null', () => {
    const doc = validDoc();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('OPEN');
    expect(doc.reviewed_by).toBeNull();
    expect(doc.reviewed_at).toBeNull();
  });

  it('accepts every recommendation status', () => {
    for (const status of ['OPEN', 'APPROVED', 'REJECTED', 'SUPERSEDED']) {
      const doc = validDoc({ status });
      expect(doc.validateSync()).toBeUndefined();
    }
  });

  it('rejects an unknown status or generation_source', () => {
    expect(validDoc({ status: 'PENDING' }).validateSync()?.errors.status).toBeDefined();
    expect(validDoc({ generation_source: 'manual' }).validateSync()?.errors.generation_source).toBeDefined();
  });

  it('enforces at most one OPEN recommendation per (org, workflow_type, persona) group via a partial unique index', () => {
    const indexes = SendTimeRecommendation.schema.indexes();
    const compound = indexes.find(
      ([fields, options]) =>
        fields.org_id === 1 && fields.workflow_type === 1 && fields.persona === 1 && options.partialFilterExpression,
    );
    expect(compound).toBeDefined();
    expect(compound?.[1].unique).toBe(true);
    expect(compound?.[1].partialFilterExpression).toEqual({ status: 'OPEN' });
  });
});

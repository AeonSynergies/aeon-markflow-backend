import { CrossOrgInsight } from '../../src/models/CrossOrgInsight.model';

function validDoc(overrides: Record<string, unknown> = {}) {
  return new CrossOrgInsight({
    insight_type: 'step_count',
    step_count: 4,
    org_count: 3,
    sample_size: 12,
    confidence: 'emerging',
    computed_at: new Date(),
    ...overrides,
  });
}

describe('CrossOrgInsight model', () => {
  it('requires insight_type, org_count, sample_size, confidence, and computed_at', () => {
    const doc = new CrossOrgInsight({});
    const err = doc.validateSync();
    expect(err?.errors.insight_type).toBeDefined();
    expect(err?.errors.org_count).toBeDefined();
    expect(err?.errors.sample_size).toBeDefined();
    expect(err?.errors.confidence).toBeDefined();
    expect(err?.errors.computed_at).toBeDefined();
  });

  it('rejects an unknown insight_type or confidence level', () => {
    expect(validDoc({ insight_type: 'other' }).validateSync()?.errors.insight_type).toBeDefined();
    expect(validDoc({ confidence: 'high' }).validateSync()?.errors.confidence).toBeDefined();
  });

  it('defaults workflow_type/persona to null', () => {
    const doc = validDoc();
    expect(doc.workflow_type).toBeNull();
    expect(doc.persona).toBeNull();
  });

  it('accepts a sequence_shape document with step_kinds and sequence_key', () => {
    const doc = validDoc({
      insight_type: 'sequence_shape',
      step_count: undefined,
      step_kinds: ['email', 'wait', 'call_task', 'email'],
      sequence_key: 'email>wait>call_task>email',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.step_kinds).toEqual(['email', 'wait', 'call_task', 'email']);
  });

  it('accepts a send_time_window document with avg_reply_rate/avg_meeting_rate', () => {
    const doc = validDoc({
      insight_type: 'send_time_window',
      step_count: undefined,
      day_of_week: 3,
      hour_bucket: 9,
      timezone_bucket: 'America/New_York',
      avg_reply_rate: 0.22,
      avg_meeting_rate: 0.05,
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('enforces one document per distinct pattern via a unique compound index', () => {
    const indexes = CrossOrgInsight.schema.indexes();
    const compound = indexes.find(([fields]) => fields.insight_type === 1 && fields.sequence_key === 1);
    expect(compound).toBeDefined();
    expect(compound?.[1].unique).toBe(true);
  });
});

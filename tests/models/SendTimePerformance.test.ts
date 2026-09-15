import { Types } from 'mongoose';
import { SendTimePerformance } from '../../src/models/SendTimePerformance.model';

function validDoc(overrides: Record<string, unknown> = {}) {
  return new SendTimePerformance({
    org_id: new Types.ObjectId(),
    day_of_week: 3,
    hour_bucket: 9,
    timezone_bucket: 'America/New_York',
    content_variant_id: new Types.ObjectId(),
    ...overrides,
  });
}

describe('SendTimePerformance model', () => {
  it('requires org_id, day_of_week, hour_bucket, timezone_bucket, and content_variant_id', () => {
    const doc = new SendTimePerformance({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.day_of_week).toBeDefined();
    expect(err?.errors.hour_bucket).toBeDefined();
    expect(err?.errors.timezone_bucket).toBeDefined();
    expect(err?.errors.content_variant_id).toBeDefined();
  });

  it('defaults workflow_type/persona to null and rate/count fields to 0', () => {
    const doc = validDoc();
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.workflow_type).toBeNull();
    expect(doc.persona).toBeNull();
    expect(doc.sent_count).toBe(0);
    expect(doc.reply_rate).toBe(0);
    expect(doc.meeting_rate).toBe(0);
    expect(doc.sample_size).toBe(0);
  });

  it('rejects an out-of-range day_of_week or hour_bucket', () => {
    const badDay = validDoc({ day_of_week: 7 });
    expect(badDay.validateSync()?.errors.day_of_week).toBeDefined();

    const badHour = validDoc({ hour_bucket: 24 });
    expect(badHour.validateSync()?.errors.hour_bucket).toBeDefined();
  });

  it('enforces one document per bucket via a unique compound index', () => {
    const indexes = SendTimePerformance.schema.indexes();
    const compound = indexes.find(([fields]) => 'content_variant_id' in fields && 'day_of_week' in fields);
    expect(compound).toBeDefined();
    expect(compound?.[1].unique).toBe(true);
  });
});

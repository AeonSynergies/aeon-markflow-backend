import { Types } from 'mongoose';
import { EmailEngagement } from '../../src/models/EmailEngagement.model';

describe('EmailEngagement model', () => {
  it('requires org_id, lead_id, email_template_version_id, and sent_at', () => {
    const doc = new EmailEngagement({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.lead_id).toBeDefined();
    expect(err?.errors.email_template_version_id).toBeDefined();
    expect(err?.errors.sent_at).toBeDefined();
  });

  it('defaults opened/clicked to false and their counters/timestamps to zero/null', () => {
    const doc = new EmailEngagement({
      org_id: new Types.ObjectId(),
      lead_id: new Types.ObjectId(),
      email_template_version_id: new Types.ObjectId(),
      sent_at: new Date(),
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.opened).toBe(false);
    expect(doc.open_count).toBe(0);
    expect(doc.first_opened_at).toBeNull();
    expect(doc.clicked).toBe(false);
    expect(doc.click_count).toBe(0);
    expect(doc.first_clicked_at).toBeNull();
  });

  it('defaults the send-time-optimization bucket fields to null', () => {
    const doc = new EmailEngagement({
      org_id: new Types.ObjectId(),
      lead_id: new Types.ObjectId(),
      email_template_version_id: new Types.ObjectId(),
      sent_at: new Date(),
    });
    expect(doc.workflow_type).toBeNull();
    expect(doc.persona).toBeNull();
    expect(doc.day_of_week).toBeNull();
    expect(doc.hour_bucket).toBeNull();
    expect(doc.timezone_bucket).toBeNull();
  });

  it('accepts explicit bucket values', () => {
    const doc = new EmailEngagement({
      org_id: new Types.ObjectId(),
      lead_id: new Types.ObjectId(),
      email_template_version_id: new Types.ObjectId(),
      sent_at: new Date(),
      workflow_type: 'cold_outreach',
      persona: 'fedex_isp',
      day_of_week: 2,
      hour_bucket: 9,
      timezone_bucket: 'America/New_York',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.day_of_week).toBe(2);
    expect(doc.hour_bucket).toBe(9);
    expect(doc.timezone_bucket).toBe('America/New_York');
  });
});

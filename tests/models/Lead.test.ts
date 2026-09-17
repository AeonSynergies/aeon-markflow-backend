import { Types } from 'mongoose';
import { Lead } from '../../src/models/Lead.model';

describe('Lead model', () => {
  const contact_id = new Types.ObjectId();
  const org_id = new Types.ObjectId();

  it('requires contact_id and org_id', () => {
    const doc = new Lead({});
    const err = doc.validateSync();
    expect(err?.errors.contact_id).toBeDefined();
    expect(err?.errors.org_id).toBeDefined();
  });

  it('defaults status to NEW-COLD and email_deliverability to GOOD', () => {
    const doc = new Lead({ contact_id, org_id });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.status).toBe('NEW-COLD');
    expect(doc.email_deliverability).toBe('GOOD');
    expect(doc.phone_dnd_status).toBe(false);
  });

  it('rejects an invalid status', () => {
    const doc = new Lead({ contact_id, org_id, status: 'WON' });
    const err = doc.validateSync();
    expect(err?.errors.status).toBeDefined();
  });

  it('accepts every documented status value', () => {
    const statuses = [
      'NEW-COLD',
      'NEW-INBOUND',
      'CONTACTED',
      'CONTACTED-PHONE',
      'CONTACTED-EMAIL',
      'PROSPECT',
      'INACTIVE',
      'RECLAIMED',
      'DISCOVERY_RETRY',
    ];
    for (const status of statuses) {
      const doc = new Lead({ contact_id, org_id, status });
      expect(doc.validateSync()).toBeUndefined();
    }
  });

  it('enforces one Lead per (contact_id, org_id) via a compound unique index', () => {
    const indexes = Lead.schema.indexes();
    const compound = indexes.find(
      ([fields]) => fields.contact_id === 1 && fields.org_id === 1,
    );
    expect(compound).toBeDefined();
    expect(compound?.[1].unique).toBe(true);
  });

  it('allows recycled-lead fields for a lead coming back from a lost Deal', () => {
    const doc = new Lead({
      contact_id,
      org_id,
      status: 'RECLAIMED',
      recycled_from_deal_id: new Types.ObjectId(),
      lost_reason: 'price',
      lost_stage: 'discovery',
      eligible_for_reengagement_at: new Date('2026-01-01'),
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('allows discovery_retry_started_at for a lead in the DISCOVERY_RETRY tier', () => {
    const doc = new Lead({
      contact_id,
      org_id,
      status: 'DISCOVERY_RETRY',
      recycled_from_deal_id: new Types.ObjectId(),
      lost_reason: 'no_show',
      lost_stage: 'discovery',
      discovery_retry_started_at: new Date('2026-01-01'),
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.discovery_retry_started_at).toEqual(new Date('2026-01-01'));
  });

  it('defaults discovery_retry_started_at to null', () => {
    const doc = new Lead({ contact_id, org_id });
    expect(doc.discovery_retry_started_at).toBeNull();
  });
});

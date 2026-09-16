import { Types } from 'mongoose';
import { GuardrailSettings } from '../../src/models/GuardrailSettings.model';

describe('GuardrailSettings model', () => {
  it('requires org_id and domain', () => {
    const doc = new GuardrailSettings({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.domain).toBeDefined();
  });

  it('leaves every threshold field unset by default — no field defaults to zero', () => {
    const doc = new GuardrailSettings({ org_id: new Types.ObjectId(), domain: 'mail.aeonsynergies.com' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.ramp_up_starting_daily_cap).toBeUndefined();
    expect(doc.hard_stop_bounce_rate).toBeUndefined();
  });

  it('accepts a partial override of just some fields', () => {
    const doc = new GuardrailSettings({
      org_id: new Types.ObjectId(),
      domain: 'mail.aeonsynergies.com',
      ramp_up_starting_daily_cap: 50,
      hard_stop_bounce_rate: 0.03,
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.ramp_up_starting_daily_cap).toBe(50);
    expect(doc.hard_stop_bounce_rate).toBe(0.03);
    expect(doc.guardrail_min_sample_size).toBeUndefined();
  });

  it('enforces one settings document per (org_id, domain) pair via a unique compound index', () => {
    const indexes = GuardrailSettings.schema.indexes();
    const compoundIndex = indexes.find(([fields]) => fields.org_id === 1 && fields.domain === 1);
    expect(compoundIndex?.[1].unique).toBe(true);
  });
});

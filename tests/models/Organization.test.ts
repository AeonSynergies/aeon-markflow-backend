import { Organization } from '../../src/models/Organization.model';

const AEON_MILES_PRODUCT_CONTEXT =
  'Amazon DSP back-office suite (payroll, bookkeeping, disputes, analytics, dispatch, recruitment) for Amazon DSP operators.';

describe('Organization model', () => {
  it('requires name and product_context', () => {
    const doc = new Organization({});
    const err = doc.validateSync();
    expect(err?.errors.name).toBeDefined();
    expect(err?.errors.product_context).toBeDefined();
  });

  it('rejects a blank product_context', () => {
    const doc = new Organization({ name: 'Aeon Miles', product_context: '   ' });
    const err = doc.validateSync();
    expect(err?.errors.product_context).toBeDefined();
  });

  it('accepts a free-text product_context describing what the org sells and its ICP', () => {
    const doc = new Organization({ name: 'Aeon Miles', product_context: AEON_MILES_PRODUCT_CONTEXT });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.product_context).toBe(AEON_MILES_PRODUCT_CONTEXT);
    expect(doc.enabled_features).toEqual([]);
    expect(doc.sending_domains).toEqual([]);
  });

  it('allows multiple sending domains for a single org, each tagged with a purpose', () => {
    const doc = new Organization({
      name: 'Aeon Miles',
      product_context: AEON_MILES_PRODUCT_CONTEXT,
      sending_domains: [
        { domain: 'aeonmiles.com', purpose: 'marketing' },
        { domain: 'aeonsynergies.com', purpose: 'transactional' },
      ],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.sending_domains).toHaveLength(2);
    expect(doc.sending_domains?.[1]).toMatchObject({ domain: 'aeonsynergies.com', purpose: 'transactional' });
  });

  it('rejects a sending domain with an unknown purpose', () => {
    const doc = new Organization({
      name: 'Aeon Miles',
      product_context: AEON_MILES_PRODUCT_CONTEXT,
      sending_domains: [{ domain: 'aeonmiles.com', purpose: 'promotional' }],
    });
    const err = doc.validateSync();
    expect(err?.errors['sending_domains.0.purpose']).toBeDefined();
  });

  it('rejects a sending domain entry with no purpose', () => {
    const doc = new Organization({
      name: 'Aeon Miles',
      product_context: AEON_MILES_PRODUCT_CONTEXT,
      sending_domains: [{ domain: 'aeonmiles.com' }],
    });
    const err = doc.validateSync();
    expect(err?.errors['sending_domains.0.purpose']).toBeDefined();
  });

  it('defaults send_time_strategy to manual', () => {
    const doc = new Organization({ name: 'Aeon Miles', product_context: AEON_MILES_PRODUCT_CONTEXT });
    expect(doc.send_time_strategy).toBe('manual');
  });

  it('accepts ai_suggested and ai_automatic send_time_strategy values', () => {
    const suggested = new Organization({
      name: 'Aeon Miles',
      product_context: AEON_MILES_PRODUCT_CONTEXT,
      send_time_strategy: 'ai_suggested',
    });
    expect(suggested.validateSync()).toBeUndefined();

    const automatic = new Organization({
      name: 'Aeon Sign',
      product_context: AEON_MILES_PRODUCT_CONTEXT,
      send_time_strategy: 'ai_automatic',
    });
    expect(automatic.validateSync()).toBeUndefined();
  });

  it('rejects an unknown send_time_strategy', () => {
    const doc = new Organization({
      name: 'Aeon Miles',
      product_context: AEON_MILES_PRODUCT_CONTEXT,
      send_time_strategy: 'fully_autonomous',
    });
    expect(doc.validateSync()?.errors.send_time_strategy).toBeDefined();
  });
});

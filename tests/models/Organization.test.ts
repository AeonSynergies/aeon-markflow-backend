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

  it('allows multiple sending domains for a single org', () => {
    const doc = new Organization({
      name: 'Aeon Miles',
      product_context: AEON_MILES_PRODUCT_CONTEXT,
      sending_domains: ['aeonmiles.com', 'aeonsynergies.com'],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.sending_domains).toHaveLength(2);
  });
});

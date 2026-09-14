import { Organization } from '../../src/models/Organization.model';

describe('Organization model', () => {
  it('requires name and product_context', () => {
    const doc = new Organization({});
    const err = doc.validateSync();
    expect(err?.errors.name).toBeDefined();
    expect(err?.errors.product_context).toBeDefined();
  });

  it('rejects an unknown product_context', () => {
    const doc = new Organization({ name: 'Aeon Miles', product_context: 'not_a_real_product' });
    const err = doc.validateSync();
    expect(err?.errors.product_context).toBeDefined();
  });

  it('accepts a valid org and defaults array fields to empty', () => {
    const doc = new Organization({ name: 'Aeon Miles', product_context: 'aeon_miles' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.enabled_features).toEqual([]);
    expect(doc.sending_domains).toEqual([]);
  });

  it('allows multiple sending domains for a single org', () => {
    const doc = new Organization({
      name: 'Aeon Miles',
      product_context: 'aeon_miles',
      sending_domains: ['aeonmiles.com', 'aeonsynergies.com'],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.sending_domains).toHaveLength(2);
  });
});

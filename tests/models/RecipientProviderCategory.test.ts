import { RecipientProviderCategory } from '../../src/models/RecipientProviderCategory.model';

function validDoc(overrides: Record<string, unknown> = {}) {
  return new RecipientProviderCategory({
    domain: 'example.com',
    category: 'corporate',
    checked_at: new Date(),
    ...overrides,
  });
}

describe('RecipientProviderCategory model', () => {
  it('requires domain, category, and checked_at', () => {
    const doc = new RecipientProviderCategory({});
    const err = doc.validateSync();
    expect(err?.errors.domain).toBeDefined();
    expect(err?.errors.category).toBeDefined();
    expect(err?.errors.checked_at).toBeDefined();
  });

  it('lowercases and trims the domain, and defaults mx_hosts to empty', () => {
    const doc = validDoc({ domain: '  Example.COM  ' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.domain).toBe('example.com');
    expect(doc.mx_hosts).toEqual([]);
  });

  it('accepts both provider categories', () => {
    expect(validDoc({ category: 'consumer' }).validateSync()).toBeUndefined();
    expect(validDoc({ category: 'corporate' }).validateSync()).toBeUndefined();
  });

  it('rejects an unknown category', () => {
    expect(validDoc({ category: 'unknown' }).validateSync()?.errors.category).toBeDefined();
  });

  it('accepts recorded mx_hosts', () => {
    const doc = validDoc({ mx_hosts: ['aspmx.l.google.com', 'alt1.aspmx.l.google.com'] });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.mx_hosts).toHaveLength(2);
  });
});

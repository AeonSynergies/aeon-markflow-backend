import { BrandVoiceGuidelines } from '../../src/models/BrandVoiceGuidelines.model';

describe('BrandVoiceGuidelines model', () => {
  it('requires text and version', () => {
    const doc = new BrandVoiceGuidelines({});
    const err = doc.validateSync();
    expect(err?.errors.text).toBeDefined();
    expect(err?.errors.version).toBeDefined();
  });

  it('defaults updated_by to null', () => {
    const doc = new BrandVoiceGuidelines({ text: 'Be consultative.', version: 'abc123def456' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.updated_by).toBeNull();
  });
});

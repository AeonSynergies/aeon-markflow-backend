import { readFileSync } from 'fs';

jest.mock('fs', () => ({ readFileSync: jest.fn() }));
jest.mock('../../src/models/BrandVoiceGuidelines.model', () => ({
  BrandVoiceGuidelines: { findOne: jest.fn(), findOneAndUpdate: jest.fn() },
}));

import { BrandVoiceGuidelines } from '../../src/models/BrandVoiceGuidelines.model';
import { getBrandVoiceGuidelines, updateBrandVoiceGuidelines } from '../../src/services/brandVoice.service';

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

describe('brandVoice.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('getBrandVoiceGuidelines', () => {
    it('falls back to brand-voice-guidelines.md and derives a stable content-hash version when nothing has been edited yet', async () => {
      (BrandVoiceGuidelines.findOne as jest.Mock).mockReturnValue(lean(null));
      (readFileSync as jest.Mock).mockReturnValue('# Aeon Brand Voice\n\nBe consultative.');

      const result = await getBrandVoiceGuidelines();

      expect(readFileSync).toHaveBeenCalledTimes(1);
      expect(result.text).toContain('Be consultative');
      expect(result.version).toMatch(/^[0-9a-f]{12}$/);
    });

    it('reads the stored document instead of the file once one exists', async () => {
      (BrandVoiceGuidelines.findOne as jest.Mock).mockReturnValue(lean({ text: 'Edited voice.', version: 'abc123def456' }));

      const result = await getBrandVoiceGuidelines();

      expect(readFileSync).not.toHaveBeenCalled();
      expect(result).toEqual({ text: 'Edited voice.', version: 'abc123def456' });
    });
  });

  describe('updateBrandVoiceGuidelines', () => {
    it('upserts the singleton document with a freshly-derived version', async () => {
      (BrandVoiceGuidelines.findOneAndUpdate as jest.Mock).mockResolvedValue({
        text: 'New voice.',
        version: 'expected-hash',
      });

      const result = await updateBrandVoiceGuidelines('New voice.', 'user-1');

      expect(BrandVoiceGuidelines.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        { $set: { text: 'New voice.', version: expect.stringMatching(/^[0-9a-f]{12}$/), updated_by: 'user-1' } },
        { upsert: true, new: true },
      );
      expect(result).toEqual({ text: 'New voice.', version: 'expected-hash' });
    });

    it('defaults updated_by to null when not given', async () => {
      (BrandVoiceGuidelines.findOneAndUpdate as jest.Mock).mockResolvedValue({ text: 'x', version: 'y' });

      await updateBrandVoiceGuidelines('x');

      expect(BrandVoiceGuidelines.findOneAndUpdate).toHaveBeenCalledWith(
        {},
        expect.objectContaining({ $set: expect.objectContaining({ updated_by: null }) }),
        { upsert: true, new: true },
      );
    });
  });
});

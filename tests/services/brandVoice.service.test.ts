import { readFileSync } from 'fs';

jest.mock('fs', () => ({ readFileSync: jest.fn() }));

import { getBrandVoiceGuidelines, resetBrandVoiceGuidelinesCache } from '../../src/services/brandVoice.service';

describe('brandVoice.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetBrandVoiceGuidelinesCache();
  });

  it('reads brand-voice-guidelines.md and derives a stable content-hash version', () => {
    (readFileSync as jest.Mock).mockReturnValue('# Aeon Brand Voice\n\nBe consultative.');

    const first = getBrandVoiceGuidelines();
    expect(readFileSync).toHaveBeenCalledTimes(1);
    expect(first.text).toContain('Be consultative');
    expect(first.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('caches the result across calls until reset', () => {
    (readFileSync as jest.Mock).mockReturnValue('content');

    getBrandVoiceGuidelines();
    getBrandVoiceGuidelines();
    expect(readFileSync).toHaveBeenCalledTimes(1);

    resetBrandVoiceGuidelinesCache();
    (readFileSync as jest.Mock).mockReturnValue('content');
    getBrandVoiceGuidelines();
    expect(readFileSync).toHaveBeenCalledTimes(2);
  });

  it('changes version when the file content changes', () => {
    (readFileSync as jest.Mock).mockReturnValue('version one');
    const v1 = getBrandVoiceGuidelines().version;

    resetBrandVoiceGuidelinesCache();
    (readFileSync as jest.Mock).mockReturnValue('version two');
    const v2 = getBrandVoiceGuidelines().version;

    expect(v1).not.toBe(v2);
  });
});

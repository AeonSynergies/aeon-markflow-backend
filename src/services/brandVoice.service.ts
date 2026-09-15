import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';

const GUIDELINES_PATH = path.resolve(process.cwd(), 'brand-voice-guidelines.md');

export interface BrandVoiceGuidelines {
  text: string;
  /** Short content hash so every AI draft can log exactly which guideline revision it used. */
  version: string;
}

let cached: BrandVoiceGuidelines | undefined;

export function getBrandVoiceGuidelines(): BrandVoiceGuidelines {
  if (!cached) {
    const text = readFileSync(GUIDELINES_PATH, 'utf-8');
    const version = createHash('sha256').update(text).digest('hex').slice(0, 12);
    cached = { text, version };
  }
  return cached;
}

/** Test-only: clears the cache so a changed file (or mocked fs) is re-read. */
export function resetBrandVoiceGuidelinesCache(): void {
  cached = undefined;
}

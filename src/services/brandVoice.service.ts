import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import path from 'path';
import { BrandVoiceGuidelines } from '../models/BrandVoiceGuidelines.model';

const GUIDELINES_PATH = path.resolve(process.cwd(), 'brand-voice-guidelines.md');

export interface BrandVoiceGuidelinesData {
  text: string;
  /** Short content hash so every AI draft can log exactly which guideline revision it used. */
  version: string;
}

function hashVersion(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

function readFileGuidelines(): BrandVoiceGuidelinesData {
  const text = readFileSync(GUIDELINES_PATH, 'utf-8');
  return { text, version: hashVersion(text) };
}

/**
 * The Brand Voice guidelines, DB-backed rather than a static `brand-voice-guidelines.md` file
 * baked into the deployment image. A file can't be edited from a Settings screen — there's
 * nothing to PUT to — and even if it could, App Runner's containers aren't a durable place to
 * write one: an edit would vanish on the next restart or deploy. Falls back to that same file,
 * completely unchanged, until the first real edit through `updateBrandVoiceGuidelines` — so
 * nothing `generateEmailDraft` reads changes just because this migrated off the filesystem.
 *
 * Global, not per-org: there is exactly one current document, matching the file's own pre-existing
 * behavior. `Organization.brand_voice_guidelines_id` is not read here (see
 * BrandVoiceGuidelines.model.ts) — genuine per-org brand voice is a separate product decision.
 */
export async function getBrandVoiceGuidelines(): Promise<BrandVoiceGuidelinesData> {
  const stored = await BrandVoiceGuidelines.findOne().lean();
  if (stored) return { text: stored.text, version: stored.version };
  return readFileGuidelines();
}

export async function updateBrandVoiceGuidelines(text: string, updatedBy?: string): Promise<BrandVoiceGuidelinesData> {
  const version = hashVersion(text);
  const doc = await BrandVoiceGuidelines.findOneAndUpdate(
    {},
    { $set: { text, version, updated_by: updatedBy ?? null } },
    { upsert: true, new: true },
  );
  return { text: doc.text, version: doc.version };
}

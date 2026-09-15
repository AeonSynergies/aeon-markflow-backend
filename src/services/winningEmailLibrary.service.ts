import { readFileSync } from 'fs';
import path from 'path';
import { EmailTemplate } from '../models/EmailTemplate.model';
import { EmailTemplateVersion } from '../models/EmailTemplateVersion.model';

const SEED_PATH = path.resolve(process.cwd(), 'winning-email-library-seed.json');

export const SEED_ORG_KEYS = ['aeon_sign', 'aeon_miles', 'aeon_recruitpro', 'aeon_scheduler'] as const;
export type SeedOrgKey = (typeof SEED_ORG_KEYS)[number];

const SEED_BLOCK_KEYS: Record<SeedOrgKey, string> = {
  aeon_sign: 'aeon_sign_templates',
  aeon_miles: 'aeon_miles_templates',
  aeon_recruitpro: 'aeon_recruitpro_templates',
  aeon_scheduler: 'aeon_scheduler_templates',
};

interface SeedSequenceEntry {
  persona?: string;
  subject?: string;
  position?: string;
  notes?: string;
}

interface SeedOrgBlock {
  sequence: SeedSequenceEntry[];
  notes?: string;
}

type SeedFile = Record<string, SeedOrgBlock | string | undefined>;

let cachedSeed: SeedFile | undefined;

function loadSeed(): SeedFile {
  if (!cachedSeed) {
    cachedSeed = JSON.parse(readFileSync(SEED_PATH, 'utf-8')) as SeedFile;
  }
  return cachedSeed;
}

/** Test-only: clears the cache so a changed file (or mocked fs) is re-read. */
export function resetWinningEmailLibrarySeedCache(): void {
  cachedSeed = undefined;
}

export interface ReferenceTemplateExample {
  source: 'seed_structure' | 'approved_version';
  emailTemplateVersionId?: string;
  persona?: string;
  position?: string;
  subjectLine: string;
  bodyExcerpt?: string;
  notes?: string;
}

/**
 * Subject-line/sequence-structure examples from the committed seed file only. These carry no
 * email body copy — the six source documents they were extracted from (Aeon_Sign_Amazon.docx,
 * Email_and_Calling_Aeon_Miles.docx, etc.) aren't committed to this repo, only referenced by
 * name in the seed file's own `notes` fields. So this grounds subject-line style and cadence
 * position, not full-body few-shot examples — real body copy has to come from
 * getApprovedReferenceVersions once real templates exist.
 */
export function getSeedStructureExamples(orgKey: SeedOrgKey, persona?: string): ReferenceTemplateExample[] {
  const seed = loadSeed();
  const block = seed[SEED_BLOCK_KEYS[orgKey]];
  if (!block || typeof block === 'string') return [];

  return block.sequence
    .filter((entry) => !persona || !entry.persona || entry.persona === persona || entry.persona === 'any')
    .filter((entry): entry is SeedSequenceEntry & { subject: string } => Boolean(entry.subject))
    .map((entry) => ({
      source: 'seed_structure' as const,
      persona: entry.persona,
      position: entry.position,
      subjectLine: entry.subject,
      notes: entry.notes ?? block.notes,
    }));
}

const APPROVED_EXCERPT_LENGTH = 600;

/**
 * Real few-shot examples: approved EmailTemplateVersions for this org (and persona, if given).
 * Per CLAUDE.md's schema there's no separate "library" collection — approved templates *are*
 * the Winning Email Library, which is why this reads EmailTemplate/EmailTemplateVersion
 * directly rather than a seed file.
 */
export async function getApprovedReferenceVersions(
  orgId: string,
  persona?: string,
  limit = 3,
): Promise<ReferenceTemplateExample[]> {
  const templateQuery: Record<string, unknown> = { org_id: orgId };
  if (persona) templateQuery.persona = persona;

  const templates = await EmailTemplate.find(templateQuery).select('_id persona').lean();
  if (templates.length === 0) return [];

  const templateIds = templates.map((t) => t._id);
  const personaByTemplateId = new Map(templates.map((t) => [t._id.toString(), t.persona]));

  const versions = await EmailTemplateVersion.find({
    email_template_id: { $in: templateIds },
    status: 'APPROVED',
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  return versions.map((version) => ({
    source: 'approved_version' as const,
    emailTemplateVersionId: version._id.toString(),
    persona: personaByTemplateId.get(version.email_template_id.toString()) ?? undefined,
    subjectLine: version.subject_line,
    bodyExcerpt: version.body_html.slice(0, APPROVED_EXCERPT_LENGTH),
  }));
}

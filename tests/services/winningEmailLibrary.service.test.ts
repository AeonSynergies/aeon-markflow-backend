import { readFileSync } from 'fs';

jest.mock('fs', () => ({ readFileSync: jest.fn() }));
jest.mock('../../src/models/EmailTemplate.model', () => ({ EmailTemplate: { find: jest.fn() } }));
jest.mock('../../src/models/EmailTemplateVersion.model', () => ({ EmailTemplateVersion: { find: jest.fn() } }));

import { EmailTemplate } from '../../src/models/EmailTemplate.model';
import { EmailTemplateVersion } from '../../src/models/EmailTemplateVersion.model';
import {
  getApprovedReferenceVersions,
  getSeedStructureExamples,
  resetWinningEmailLibrarySeedCache,
} from '../../src/services/winningEmailLibrary.service';

const SEED_FIXTURE = {
  aeon_sign_templates: {
    sequence: [
      { persona: 'fedex_isp', subject: 'Simplify employee onboarding at {{Company}}', position: 'cold_open' },
      { persona: 'amazon_dsp_afp', subject: 'A simpler way to manage hiring documents', position: 'cold_open' },
      { persona: 'any', subject: 'Should I close the loop?', position: 'breakup_fallback' },
      { persona: 'fedex_isp', position: 'no_subject_entry' },
    ],
    notes: 'Full body copy lives in the source documents, not this repo.',
  },
  aeon_recruitpro_templates: { sequence: [], notes: 'Cold start.' },
};

describe('winningEmailLibrary.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetWinningEmailLibrarySeedCache();
    (readFileSync as jest.Mock).mockReturnValue(JSON.stringify(SEED_FIXTURE));
  });

  describe('getSeedStructureExamples', () => {
    it('filters by persona, including "any" entries, and skips entries with no subject', () => {
      const examples = getSeedStructureExamples('aeon_sign', 'fedex_isp');

      expect(examples.map((e) => e.subjectLine)).toEqual([
        'Simplify employee onboarding at {{Company}}',
        'Should I close the loop?',
      ]);
      expect(examples[0].source).toBe('seed_structure');
      expect(examples[0].notes).toContain('not this repo');
    });

    it('returns every entry with a subject when no persona is given', () => {
      const examples = getSeedStructureExamples('aeon_sign');
      expect(examples).toHaveLength(3);
    });

    it('returns an empty array for an org with no seeded sequence', () => {
      expect(getSeedStructureExamples('aeon_recruitpro')).toEqual([]);
    });

    it('returns an empty array for an org key missing from the seed file', () => {
      expect(getSeedStructureExamples('aeon_scheduler')).toEqual([]);
    });
  });

  describe('getApprovedReferenceVersions', () => {
    it('returns an empty array when the org has no templates', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });

      const result = await getApprovedReferenceVersions('org-1');
      expect(result).toEqual([]);
      expect(EmailTemplateVersion.find).not.toHaveBeenCalled();
    });

    it('joins approved versions back to their template persona and excerpts the body', async () => {
      const templateId = 'tpl-1';
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ _id: { toString: () => templateId }, persona: 'fedex_isp' }]),
      });
      (EmailTemplateVersion.find as jest.Mock).mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          {
            _id: { toString: () => 'ver-1' },
            email_template_id: { toString: () => templateId },
            subject_line: 'Managing employee documents',
            body_html: 'x'.repeat(700),
          },
        ]),
      });

      const result = await getApprovedReferenceVersions('org-1', 'fedex_isp', 3);

      expect(EmailTemplate.find).toHaveBeenCalledWith({ org_id: 'org-1', persona: 'fedex_isp' });
      expect(result).toEqual([
        {
          source: 'approved_version',
          emailTemplateVersionId: 'ver-1',
          persona: 'fedex_isp',
          subjectLine: 'Managing employee documents',
          bodyExcerpt: 'x'.repeat(600),
        },
      ]);
    });
  });
});

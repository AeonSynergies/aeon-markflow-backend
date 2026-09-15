jest.mock('../../src/models/EmailTemplate.model', () => ({
  EmailTemplate: { findById: jest.fn(), findOne: jest.fn(), find: jest.fn() },
}));
jest.mock('../../src/models/EmailTemplateVersion.model', () => ({
  EmailTemplateVersion: { create: jest.fn(), findById: jest.fn() },
}));
jest.mock('../../src/models/ReviewTask.model', () => ({
  ReviewTask: { create: jest.fn(), findOne: jest.fn() },
}));
jest.mock('../../src/services/abTesting.service', () => ({ createVariantTemplate: jest.fn() }));
jest.mock('../../src/services/emailGeneration.service', () => ({ generateEmailDraft: jest.fn() }));
jest.mock('../../src/services/emailPerformanceAnalysis.service', () => ({ diagnoseVersion: jest.fn() }));

import { EmailTemplate } from '../../src/models/EmailTemplate.model';
import { EmailTemplateVersion } from '../../src/models/EmailTemplateVersion.model';
import { ReviewTask } from '../../src/models/ReviewTask.model';
import { createVariantTemplate } from '../../src/services/abTesting.service';
import { generateEmailDraft } from '../../src/services/emailGeneration.service';
import {
  createAiSuggestionFromDiagnosis,
  flagVersionDeliverabilityIssue,
  runEmailPerformanceAnalysis,
} from '../../src/services/emailOptimization.service';
import { diagnoseVersion } from '../../src/services/emailPerformanceAnalysis.service';
import type { SymptomDiagnosis } from '../../src/services/emailPerformanceAnalysis.service';

function metrics(overrides: Record<string, unknown> = {}) {
  return {
    sentCount: 100,
    bouncedCount: 0,
    openedCount: 50,
    clickedCount: 10,
    repliedCount: 1,
    bounceRate: 0,
    openRate: 0.5,
    clickThroughRate: 0.2,
    replyRateAmongClickers: 0.1,
    ...overrides,
  };
}

describe('emailOptimization.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createAiSuggestionFromDiagnosis', () => {
    const diagnosis: SymptomDiagnosis = {
      symptom: 'no_click_through',
      reason: 'Opened 50% of the time but clicked only 2%.',
      metrics: metrics({ clickedCount: 2 }),
    };

    it('throws for a high_bounce_rate diagnosis instead of producing a content suggestion', async () => {
      const bounceDiagnosis: SymptomDiagnosis = {
        symptom: 'high_bounce_rate',
        reason: 'Bounce rate 8% over 100 sends.',
        metrics: metrics({ bouncedCount: 8, bounceRate: 0.08 }),
      };
      (EmailTemplate.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ ab_group_id: null }) });

      await expect(
        createAiSuggestionFromDiagnosis('tpl-1', { subjectLine: 'Hi', bodyHtml: '<p>Hi</p>' }, bounceDiagnosis),
      ).rejects.toThrow(/high_bounce_rate/);
      expect(createVariantTemplate).not.toHaveBeenCalled();
    });

    it('returns null when a suggestion is already outstanding for this template', async () => {
      (EmailTemplate.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ab_group_id: 'group-1' }),
      });
      (EmailTemplate.findOne as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'tpl-pending' }),
      });

      const result = await createAiSuggestionFromDiagnosis(
        'tpl-1',
        { subjectLine: 'Hi', bodyHtml: '<p>Hi</p>' },
        diagnosis,
      );

      expect(result).toBeNull();
      expect(createVariantTemplate).not.toHaveBeenCalled();
    });

    it('creates a variant template and a DRAFT version carrying the diagnosis in its metadata', async () => {
      (EmailTemplate.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ ab_group_id: null }) });
      (createVariantTemplate as jest.Mock).mockResolvedValue({ _id: 'tpl-variant' });
      (generateEmailDraft as jest.Mock).mockResolvedValue({
        subjectLine: 'A clearer ask',
        bodyHtml: '<p>New body</p>',
        reason: 'Simplified the CTA',
        referenceTemplates: [{ source: 'approved_version', emailTemplateVersionId: 'ver-9', subjectLine: 'x' }],
        brandVoiceGuidelinesVersion: 'v1',
        model: 'claude-opus-5',
      });
      (EmailTemplateVersion.create as jest.Mock).mockResolvedValue({ _id: 'ver-new' });

      await createAiSuggestionFromDiagnosis('tpl-1', { subjectLine: 'Hi', bodyHtml: '<p>Hi</p>' }, diagnosis);

      expect(createVariantTemplate).toHaveBeenCalledWith('tpl-1');
      expect(generateEmailDraft).toHaveBeenCalledWith({
        emailTemplateId: 'tpl-1',
        request: {
          type: 'diagnosis_revision',
          symptom: 'no_click_through',
          diagnosisReason: diagnosis.reason,
          currentSubjectLine: 'Hi',
          currentBodyHtml: '<p>Hi</p>',
        },
      });
      expect(EmailTemplateVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email_template_id: 'tpl-variant',
          version_number: 1,
          subject_line: 'A clearer ask',
          body_html: '<p>New body</p>',
          generation_source: 'ai',
          status: 'DRAFT',
          ai_generation_metadata: expect.objectContaining({
            reason: `[no_click_through] ${diagnosis.reason} — Simplified the CTA`,
            reference_templates: ['ver-9'],
          }),
        }),
      );
    });
  });

  describe('flagVersionDeliverabilityIssue', () => {
    const diagnosis: SymptomDiagnosis = {
      symptom: 'high_bounce_rate',
      reason: 'Bounce rate 8% over 100 sends.',
      metrics: metrics({ bouncedCount: 8, bounceRate: 0.08 }),
    };

    it('creates an OPEN ReviewTask referencing the version', async () => {
      (ReviewTask.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      (ReviewTask.create as jest.Mock).mockResolvedValue({ _id: 'task-1' });

      await flagVersionDeliverabilityIssue('ver-1', 'org-1', diagnosis);

      expect(ReviewTask.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        kind: 'email_version_deliverability',
        email_template_version_id: 'ver-1',
        status: 'OPEN',
        rejection_reason: diagnosis.reason,
      });
    });

    it('does nothing when an OPEN flag already exists for this version', async () => {
      (ReviewTask.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'task-1' }) });

      const result = await flagVersionDeliverabilityIssue('ver-1', 'org-1', diagnosis);

      expect(result).toBeNull();
      expect(ReviewTask.create).not.toHaveBeenCalled();
    });
  });

  describe('runEmailPerformanceAnalysis', () => {
    it('skips templates with no diagnosable symptom', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: 'tpl-1', org_id: { toString: () => 'org-1' }, current_version_id: { toString: () => 'ver-1' } }]),
      });
      (diagnoseVersion as jest.Mock).mockResolvedValue(null);

      const summary = await runEmailPerformanceAnalysis();

      expect(summary).toEqual({ scanned: 1, diagnosed: 0, suggestionsCreated: 0, deliverabilityFlagsCreated: 0, skipped: 1 });
    });

    it('routes high_bounce_rate to a deliverability flag, not a content suggestion', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: 'tpl-1', org_id: { toString: () => 'org-1' }, current_version_id: { toString: () => 'ver-1' } }]),
      });
      const diagnosis: SymptomDiagnosis = {
        symptom: 'high_bounce_rate',
        reason: 'Bounce rate 8%.',
        metrics: metrics({ bouncedCount: 8, bounceRate: 0.08 }),
      };
      (diagnoseVersion as jest.Mock).mockResolvedValue(diagnosis);
      (ReviewTask.findOne as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      (ReviewTask.create as jest.Mock).mockResolvedValue({ _id: 'task-1' });

      const summary = await runEmailPerformanceAnalysis();

      expect(ReviewTask.create).toHaveBeenCalled();
      expect(EmailTemplateVersion.findById).not.toHaveBeenCalled();
      expect(summary).toEqual({ scanned: 1, diagnosed: 1, suggestionsCreated: 0, deliverabilityFlagsCreated: 1, skipped: 0 });
    });

    it('routes a content-fixable diagnosis to a new AI suggestion', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: 'tpl-1', org_id: { toString: () => 'org-1' }, current_version_id: { toString: () => 'ver-1' } }]),
      });
      const diagnosis: SymptomDiagnosis = {
        symptom: 'no_click_through',
        reason: 'Opened but rarely clicked.',
        metrics: metrics({ clickedCount: 2 }),
      };
      (diagnoseVersion as jest.Mock).mockResolvedValue(diagnosis);
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ subject_line: 'Hi', body_html: '<p>Hi</p>' }),
      });
      (EmailTemplate.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ ab_group_id: null }) });
      (createVariantTemplate as jest.Mock).mockResolvedValue({ _id: 'tpl-variant' });
      (generateEmailDraft as jest.Mock).mockResolvedValue({
        subjectLine: 'New',
        bodyHtml: '<p>New</p>',
        reason: 'Clearer CTA',
        referenceTemplates: [],
        brandVoiceGuidelinesVersion: 'v1',
        model: 'claude-opus-5',
      });
      (EmailTemplateVersion.create as jest.Mock).mockResolvedValue({ _id: 'ver-new' });

      const summary = await runEmailPerformanceAnalysis();

      expect(summary).toEqual({ scanned: 1, diagnosed: 1, suggestionsCreated: 1, deliverabilityFlagsCreated: 0, skipped: 0 });
    });
  });
});

jest.mock('../../src/models/EmailTemplate.model', () => ({
  EmailTemplate: { findById: jest.fn(), findByIdAndUpdate: jest.fn() },
}));
jest.mock('../../src/models/EmailTemplateVersion.model', () => ({
  EmailTemplateVersion: { findById: jest.fn(), countDocuments: jest.fn(), create: jest.fn() },
}));
jest.mock('../../src/models/ReviewTask.model', () => ({
  ReviewTask: { create: jest.fn(), findOneAndUpdate: jest.fn() },
}));
jest.mock('../../src/services/emailGeneration.service', () => ({ generateEmailDraft: jest.fn() }));
jest.mock('../../src/services/internalNotification.service', () => ({ sendInternalNotification: jest.fn() }));

import { EmailTemplate } from '../../src/models/EmailTemplate.model';
import { EmailTemplateVersion } from '../../src/models/EmailTemplateVersion.model';
import { ReviewTask } from '../../src/models/ReviewTask.model';
import { generateEmailDraft } from '../../src/services/emailGeneration.service';
import { sendInternalNotification } from '../../src/services/internalNotification.service';
import {
  InvalidTemplateVersionTransitionError,
  UnauthorizedApproverRoleError,
  approveVersion,
  createAiDraftVersion,
  rejectVersion,
  resubmitVersion,
  submitForReview,
} from '../../src/services/emailTemplateVersion.service';

function mockVersion(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: 'ver-1',
    email_template_id: 'tpl-1',
    status: 'DRAFT',
    generation_source: 'ai',
    subject_line: 'Original',
    body_html: '<p>Original</p>',
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  (EmailTemplateVersion.findById as jest.Mock).mockResolvedValue(doc);
  return doc;
}

describe('emailTemplateVersion.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createAiDraftVersion', () => {
    it('persists a DRAFT version from the generated draft, logging reference templates and guideline version', async () => {
      (generateEmailDraft as jest.Mock).mockResolvedValue({
        subjectLine: 'A simpler way',
        bodyHtml: '<p>Hi</p>',
        reason: 'Cold open angle',
        referenceTemplates: [
          { source: 'approved_version', emailTemplateVersionId: 'ver-9', subjectLine: 'x' },
          { source: 'seed_structure', subjectLine: 'y' },
        ],
        brandVoiceGuidelinesVersion: 'abc123def456',
        model: 'claude-opus-5',
      });
      (EmailTemplateVersion.countDocuments as jest.Mock).mockResolvedValue(2);
      (EmailTemplateVersion.create as jest.Mock).mockResolvedValue({ _id: 'ver-3' });

      await createAiDraftVersion('tpl-1', { type: 'new_template', instructions: 'draft it' });

      expect(EmailTemplateVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email_template_id: 'tpl-1',
          version_number: 3,
          subject_line: 'A simpler way',
          body_html: '<p>Hi</p>',
          generation_source: 'ai',
          status: 'DRAFT',
          ai_draft_snapshot: { subject_line: 'A simpler way', body_html: '<p>Hi</p>' },
          ai_generation_metadata: expect.objectContaining({
            reference_templates: ['ver-9'],
            reason: 'Cold open angle',
            brand_voice_guidelines_version: 'abc123def456',
            model: 'claude-opus-5',
          }),
        }),
      );
    });
  });

  describe('submitForReview', () => {
    it('moves DRAFT to PENDING_APPROVAL and opens a ReviewTask', async () => {
      const version = mockVersion({ status: 'DRAFT' });
      (EmailTemplate.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ org_id: 'org-1' }),
      });

      await submitForReview('ver-1', 'user-1');

      expect(version.status).toBe('PENDING_APPROVAL');
      expect(version.save).toHaveBeenCalled();
      expect(ReviewTask.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        email_template_version_id: 'ver-1',
        requested_by: 'user-1',
      });
      expect(sendInternalNotification).toHaveBeenCalledWith(
        expect.objectContaining({ subject: expect.stringContaining('pending review') }),
      );
    });

    it('also allows RESUBMITTED to move to PENDING_APPROVAL', async () => {
      mockVersion({ status: 'RESUBMITTED' });
      (EmailTemplate.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue({ org_id: 'org-1' }) });

      const version = await submitForReview('ver-1');
      expect(version.status).toBe('PENDING_APPROVAL');
    });

    it('rejects submitting an APPROVED version', async () => {
      mockVersion({ status: 'APPROVED' });
      await expect(submitForReview('ver-1')).rejects.toThrow(InvalidTemplateVersionTransitionError);
      expect(ReviewTask.create).not.toHaveBeenCalled();
    });
  });

  describe('approveVersion', () => {
    it('approves a PENDING_APPROVAL version for an authorized role and pins current_version_id', async () => {
      const version = mockVersion({ status: 'PENDING_APPROVAL' });

      await approveVersion('ver-1', 'user-2', 'BD_SALES');

      expect(version.status).toBe('APPROVED');
      expect(ReviewTask.findOneAndUpdate).toHaveBeenCalledWith(
        { email_template_version_id: 'ver-1', status: 'OPEN' },
        expect.objectContaining({ status: 'APPROVED', reviewed_by: 'user-2' }),
      );
      expect(EmailTemplate.findByIdAndUpdate).toHaveBeenCalledWith('tpl-1', { current_version_id: 'ver-1' });
    });

    it('rejects an unauthorized role before touching the version', async () => {
      mockVersion({ status: 'PENDING_APPROVAL' });

      await expect(approveVersion('ver-1', 'user-2', 'BD_LEAD_GEN')).rejects.toThrow(
        UnauthorizedApproverRoleError,
      );
      expect(EmailTemplateVersion.findById).not.toHaveBeenCalled();
    });

    it('rejects approving a DRAFT version directly', async () => {
      mockVersion({ status: 'DRAFT' });
      await expect(approveVersion('ver-1', 'user-2', 'ADMIN')).rejects.toThrow(
        InvalidTemplateVersionTransitionError,
      );
    });
  });

  describe('rejectVersion', () => {
    it('rejects a PENDING_APPROVAL version with a reason', async () => {
      const version = mockVersion({ status: 'PENDING_APPROVAL' });

      await rejectVersion('ver-1', 'user-2', 'BD_MANAGER', 'Tone is off-brand');

      expect(version.status).toBe('REJECTED');
      expect(ReviewTask.findOneAndUpdate).toHaveBeenCalledWith(
        { email_template_version_id: 'ver-1', status: 'OPEN' },
        expect.objectContaining({ status: 'REJECTED', rejection_reason: 'Tone is off-brand' }),
      );
    });

    it('rejects an unauthorized role', async () => {
      mockVersion({ status: 'PENDING_APPROVAL' });
      await expect(rejectVersion('ver-1', 'user-2', 'BD_ADMIN', 'no')).rejects.toThrow(
        UnauthorizedApproverRoleError,
      );
    });
  });

  describe('resubmitVersion', () => {
    it('moves REJECTED to RESUBMITTED and applies edits, flipping generation_source', async () => {
      const version = mockVersion({ status: 'REJECTED', generation_source: 'ai' });

      await resubmitVersion('ver-1', { subjectLine: 'Edited subject' });

      expect(version.status).toBe('RESUBMITTED');
      expect(version.subject_line).toBe('Edited subject');
      expect(version.generation_source).toBe('ai_edited_by_human');
    });

    it('leaves a human-authored generation_source untouched', async () => {
      const version = mockVersion({ status: 'REJECTED', generation_source: 'human' });

      await resubmitVersion('ver-1', { bodyHtml: '<p>fixed</p>' });

      expect(version.generation_source).toBe('human');
    });

    it('rejects resubmitting a DRAFT version', async () => {
      mockVersion({ status: 'DRAFT' });
      await expect(resubmitVersion('ver-1')).rejects.toThrow(InvalidTemplateVersionTransitionError);
    });
  });
});

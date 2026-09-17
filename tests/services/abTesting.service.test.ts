jest.mock('../../src/models/EmailTemplate.model', () => ({
  EmailTemplate: { findById: jest.fn(), find: jest.fn(), create: jest.fn(), updateMany: jest.fn() },
}));
jest.mock('../../src/models/EmailTemplateVersion.model', () => ({
  EmailTemplateVersion: { findById: jest.fn() },
}));
jest.mock('../../src/services/emailPerformanceAnalysis.service', () => ({ computeVersionMetrics: jest.fn() }));

import { EmailTemplate } from '../../src/models/EmailTemplate.model';
import { EmailTemplateVersion } from '../../src/models/EmailTemplateVersion.model';
import {
  InsufficientAbTestSampleError,
  createVariantTemplate,
  ensureAbGroupId,
  getAbGroupResults,
  promoteWinner,
  resolveStepForEnrollment,
} from '../../src/services/abTesting.service';
import { EmailTemplateNotFoundError, UnauthorizedApproverRoleError } from '../../src/services/emailTemplateVersion.service';
import { computeVersionMetrics } from '../../src/services/emailPerformanceAnalysis.service';

describe('abTesting.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('ensureAbGroupId', () => {
    it('returns the existing ab_group_id without saving when already set', async () => {
      const doc = { ab_group_id: { toString: () => 'group-1' }, save: jest.fn() };
      (EmailTemplate.findById as jest.Mock).mockResolvedValue(doc);

      const result = await ensureAbGroupId('tpl-1');

      expect(result).toBe('group-1');
      expect(doc.save).not.toHaveBeenCalled();
    });

    it('assigns and persists a new ab_group_id when none exists yet', async () => {
      const doc: Record<string, unknown> = { ab_group_id: null, save: jest.fn().mockResolvedValue(undefined) };
      (EmailTemplate.findById as jest.Mock).mockResolvedValue(doc);

      const result = await ensureAbGroupId('tpl-1');

      expect(typeof result).toBe('string');
      expect(doc.ab_group_id).toBeDefined();
      expect(doc.save).toHaveBeenCalled();
    });

    it('throws when the template does not exist', async () => {
      (EmailTemplate.findById as jest.Mock).mockResolvedValue(null);
      await expect(ensureAbGroupId('missing')).rejects.toBeInstanceOf(EmailTemplateNotFoundError);
    });
  });

  describe('createVariantTemplate', () => {
    it('creates a new EmailTemplate sharing the incumbent org/persona/position and ab_group_id, with no live version', async () => {
      (EmailTemplate.findById as jest.Mock)
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue({
            org_id: 'org-1',
            name: 'Cold Open',
            persona: 'founder',
            workflow_position: 1,
          }),
        })
        .mockResolvedValueOnce({ ab_group_id: { toString: () => 'group-1' }, save: jest.fn() });
      (EmailTemplate.create as jest.Mock).mockResolvedValue({ _id: 'tpl-2' });

      await createVariantTemplate('tpl-1');

      expect(EmailTemplate.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        name: 'Cold Open (variant)',
        persona: 'founder',
        workflow_position: 1,
        ab_group_id: 'group-1',
        current_version_id: null,
      });
    });

    it('honors a custom variant name when given', async () => {
      (EmailTemplate.findById as jest.Mock)
        .mockReturnValueOnce({
          lean: jest.fn().mockResolvedValue({ org_id: 'org-1', name: 'Cold Open', persona: null, workflow_position: 1 }),
        })
        .mockResolvedValueOnce({ ab_group_id: { toString: () => 'group-1' }, save: jest.fn() });
      (EmailTemplate.create as jest.Mock).mockResolvedValue({ _id: 'tpl-2' });

      await createVariantTemplate('tpl-1', 'Bolder subject test');

      expect(EmailTemplate.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Bolder subject test' }),
      );
    });

    it('throws when the incumbent template does not exist', async () => {
      (EmailTemplate.findById as jest.Mock).mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) });
      await expect(createVariantTemplate('missing')).rejects.toBeInstanceOf(EmailTemplateNotFoundError);
    });
  });

  describe('resolveStepForEnrollment', () => {
    it('passes through non-email steps unchanged', async () => {
      const step = { kind: 'wait', wait_days: 3 } as never;
      const result = await resolveStepForEnrollment(step);
      expect(result).toBe(step);
      expect(EmailTemplateVersion.findById).not.toHaveBeenCalled();
    });

    it('passes through an email step with no pinned version unchanged', async () => {
      const step = { kind: 'email', email_template_version_id: undefined } as never;
      const result = await resolveStepForEnrollment(step);
      expect(result).toBe(step);
    });

    it('passes through unchanged when the version no longer exists', async () => {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      const step = { kind: 'email', email_template_version_id: 'ver-1' } as never;
      const result = await resolveStepForEnrollment(step);
      expect(result).toBe(step);
    });

    it('passes through unchanged when the template has no ab_group_id', async () => {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ email_template_id: 'tpl-1' }),
      });
      (EmailTemplate.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ab_group_id: null }),
      });
      const step = { kind: 'email', email_template_version_id: 'ver-1' } as never;
      const result = await resolveStepForEnrollment(step);
      expect(result).toBe(step);
    });

    it('passes through unchanged when only one live variant exists in the group', async () => {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ email_template_id: 'tpl-1' }),
      });
      (EmailTemplate.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ab_group_id: 'group-1' }),
      });
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([{ current_version_id: { toString: () => 'ver-1' } }]),
      });
      const step = { kind: 'email', email_template_version_id: 'ver-1' } as never;
      const result = await resolveStepForEnrollment(step);
      expect(result).toBe(step);
    });

    it('picks one of the live variants when 2+ exist in the group', async () => {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ email_template_id: 'tpl-1' }),
      });
      (EmailTemplate.findById as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue({ ab_group_id: 'group-1' }),
      });
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([
          { current_version_id: { toString: () => 'ver-1' } },
          { current_version_id: { toString: () => 'ver-2' } },
        ]),
      });
      const step = { kind: 'email', email_template_version_id: 'ver-1', sending_domain: 'aeonsign.com' } as never;

      const result = await resolveStepForEnrollment(step);

      expect(['ver-1', 'ver-2']).toContain(result.email_template_version_id);
      expect(result.sending_domain).toBe('aeonsign.com');
    });
  });

  describe('getAbGroupResults', () => {
    it('reports readyToDecide once every live variant clears the minimum sample size', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'tpl-1', name: 'Incumbent', current_version_id: { toString: () => 'ver-1' } },
          { _id: 'tpl-2', name: 'Variant', current_version_id: { toString: () => 'ver-2' } },
        ]),
      });
      (computeVersionMetrics as jest.Mock).mockResolvedValue({
        sentCount: 250,
        bouncedCount: 0,
        openedCount: 100,
        clickedCount: 20,
        repliedCount: 5,
        bounceRate: 0,
        openRate: 0.4,
        clickThroughRate: 0.2,
        replyRateAmongClickers: 0.25,
      });

      const results = await getAbGroupResults('group-1');

      expect(results.readyToDecide).toBe(true);
      expect(results.variants).toHaveLength(2);
    });

    it('is not ready when a variant has no live version yet', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'tpl-1', name: 'Incumbent', current_version_id: { toString: () => 'ver-1' } },
          { _id: 'tpl-2', name: 'Variant', current_version_id: null },
        ]),
      });
      (computeVersionMetrics as jest.Mock).mockResolvedValue({
        sentCount: 250,
        bouncedCount: 0,
        openedCount: 100,
        clickedCount: 20,
        repliedCount: 5,
        bounceRate: 0,
        openRate: 0.4,
        clickThroughRate: 0.2,
        replyRateAmongClickers: 0.25,
      });

      const results = await getAbGroupResults('group-1');

      expect(results.readyToDecide).toBe(false);
      const pending = results.variants.find((v) => v.templateId === 'tpl-2');
      expect(pending?.versionId).toBeUndefined();
      expect(pending?.metrics).toBeUndefined();
    });

    it('is not ready when a live variant is still under the minimum sample size', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'tpl-1', name: 'Incumbent', current_version_id: { toString: () => 'ver-1' } },
          { _id: 'tpl-2', name: 'Variant', current_version_id: { toString: () => 'ver-2' } },
        ]),
      });
      (computeVersionMetrics as jest.Mock).mockResolvedValue({
        sentCount: 20,
        bouncedCount: 0,
        openedCount: 5,
        clickedCount: 1,
        repliedCount: 0,
        bounceRate: 0,
        openRate: 0.25,
        clickThroughRate: 0.2,
        replyRateAmongClickers: 0,
      });

      const results = await getAbGroupResults('group-1');
      expect(results.readyToDecide).toBe(false);
    });
  });

  describe('promoteWinner', () => {
    it('throws for a non-approver role without touching the group', async () => {
      await expect(promoteWinner('group-1', 'tpl-1', 'BD_SDR' as never)).rejects.toBeInstanceOf(
        UnauthorizedApproverRoleError,
      );
      expect(EmailTemplate.updateMany).not.toHaveBeenCalled();
    });

    it('throws InsufficientAbTestSampleError when the group is not yet ready to decide', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'tpl-1', name: 'Incumbent', current_version_id: { toString: () => 'ver-1' } },
          { _id: 'tpl-2', name: 'Variant', current_version_id: null },
        ]),
      });

      await expect(promoteWinner('group-1', 'tpl-1', 'ADMIN')).rejects.toBeInstanceOf(
        InsufficientAbTestSampleError,
      );
      expect(EmailTemplate.updateMany).not.toHaveBeenCalled();
    });

    it('clears ab_group_id off every losing template once the sample is sufficient', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue({
        lean: jest.fn().mockResolvedValue([
          { _id: 'tpl-1', name: 'Incumbent', current_version_id: { toString: () => 'ver-1' } },
          { _id: 'tpl-2', name: 'Variant', current_version_id: { toString: () => 'ver-2' } },
        ]),
      });
      (computeVersionMetrics as jest.Mock).mockResolvedValue({
        sentCount: 250,
        bouncedCount: 0,
        openedCount: 100,
        clickedCount: 20,
        repliedCount: 5,
        bounceRate: 0,
        openRate: 0.4,
        clickThroughRate: 0.2,
        replyRateAmongClickers: 0.25,
      });

      await promoteWinner('group-1', 'tpl-2', 'ADMIN');

      expect(EmailTemplate.updateMany).toHaveBeenCalledWith(
        { ab_group_id: 'group-1', _id: { $ne: 'tpl-2' } },
        { ab_group_id: null },
      );
    });
  });
});

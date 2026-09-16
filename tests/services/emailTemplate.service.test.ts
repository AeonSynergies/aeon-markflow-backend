jest.mock('../../src/models/EmailTemplate.model', () => ({ EmailTemplate: { find: jest.fn(), findById: jest.fn() } }));
jest.mock('../../src/models/EmailTemplateVersion.model', () => ({ EmailTemplateVersion: { find: jest.fn() } }));
jest.mock('../../src/models/WorkflowTemplate.model', () => ({ WorkflowTemplate: { find: jest.fn() } }));

import { EmailTemplate } from '../../src/models/EmailTemplate.model';
import { EmailTemplateVersion } from '../../src/models/EmailTemplateVersion.model';
import { WorkflowTemplate } from '../../src/models/WorkflowTemplate.model';
import { EmailTemplateNotFoundError } from '../../src/services/emailTemplateVersion.service';
import {
  getEmailTemplate,
  listEmailTemplatesForOrg,
  listEmailTemplateUsages,
} from '../../src/services/emailTemplate.service';

function sortResult(value: unknown) {
  return { sort: jest.fn().mockResolvedValue(value) };
}

function selectLean(value: unknown) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(value) }) };
}

describe('emailTemplate.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('listEmailTemplatesForOrg', () => {
    it('queries by org alone when no filters are given', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue(sortResult([{ _id: 'tpl-1' }]));

      await listEmailTemplatesForOrg('org-1');

      expect(EmailTemplate.find).toHaveBeenCalledWith({ org_id: 'org-1' });
      expect(EmailTemplateVersion.find).not.toHaveBeenCalled();
    });

    it('adds persona/workflow_position/intended_workflow_type to the query when given', async () => {
      (EmailTemplate.find as jest.Mock).mockReturnValue(sortResult([]));

      await listEmailTemplatesForOrg('org-1', {
        persona: 'fedex_isp',
        workflowPosition: 'cold_open',
        intendedWorkflowType: 'cold_outreach',
      });

      expect(EmailTemplate.find).toHaveBeenCalledWith({
        org_id: 'org-1',
        persona: 'fedex_isp',
        workflow_position: 'cold_open',
        intended_workflow_type: 'cold_outreach',
      });
    });

    it('narrows by status via a join against EmailTemplateVersion, not current_version_id', async () => {
      (EmailTemplateVersion.find as jest.Mock).mockReturnValue({
        distinct: jest.fn().mockResolvedValue(['tpl-1', 'tpl-2']),
      });
      (EmailTemplate.find as jest.Mock).mockReturnValue(sortResult([]));

      await listEmailTemplatesForOrg('org-1', { status: 'APPROVED' });

      expect(EmailTemplateVersion.find).toHaveBeenCalledWith({ status: 'APPROVED' });
      expect(EmailTemplate.find).toHaveBeenCalledWith({
        org_id: 'org-1',
        _id: { $in: ['tpl-1', 'tpl-2'] },
      });
    });

    it('combines metadata filters and a status filter', async () => {
      (EmailTemplateVersion.find as jest.Mock).mockReturnValue({
        distinct: jest.fn().mockResolvedValue(['tpl-1']),
      });
      (EmailTemplate.find as jest.Mock).mockReturnValue(sortResult([]));

      await listEmailTemplatesForOrg('org-1', { persona: 'fedex_isp', status: 'APPROVED' });

      expect(EmailTemplate.find).toHaveBeenCalledWith({
        org_id: 'org-1',
        persona: 'fedex_isp',
        _id: { $in: ['tpl-1'] },
      });
    });
  });

  describe('getEmailTemplate', () => {
    it('returns the template when found', async () => {
      (EmailTemplate.findById as jest.Mock).mockResolvedValue({ _id: 'tpl-1' });
      await expect(getEmailTemplate('tpl-1')).resolves.toEqual({ _id: 'tpl-1' });
    });

    it('throws EmailTemplateNotFoundError when not found', async () => {
      (EmailTemplate.findById as jest.Mock).mockResolvedValue(null);
      await expect(getEmailTemplate('missing')).rejects.toThrow(EmailTemplateNotFoundError);
    });
  });

  describe('listEmailTemplateUsages', () => {
    beforeEach(() => {
      (EmailTemplate.findById as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
    });

    it('returns an empty array when the template has no versions at all', async () => {
      (EmailTemplateVersion.find as jest.Mock).mockReturnValue(selectLean([]));

      const usages = await listEmailTemplateUsages('tpl-1');

      expect(usages).toEqual([]);
      expect(WorkflowTemplate.find).not.toHaveBeenCalled();
    });

    it('finds every step across every WorkflowTemplate referencing any of the versions', async () => {
      (EmailTemplateVersion.find as jest.Mock).mockReturnValue(
        selectLean([
          { _id: { toString: () => 'ver-1' }, version_number: 1 },
          { _id: { toString: () => 'ver-2' }, version_number: 2 },
        ]),
      );
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(
        selectLean([
          {
            _id: { toString: () => 'wt-1' },
            name: 'Cold outreach — FedEx ISP',
            workflow_type: 'cold_outreach',
            steps: [
              { kind: 'wait' },
              { kind: 'email', email_template_version_id: { toString: () => 'ver-1' } },
              { kind: 'email', email_template_version_id: { toString: () => 'ver-2' } },
            ],
          },
          {
            _id: { toString: () => 'wt-2' },
            name: 'Win-back',
            workflow_type: null,
            steps: [{ kind: 'email', email_template_version_id: { toString: () => 'ver-1' } }],
          },
        ]),
      );

      const usages = await listEmailTemplateUsages('tpl-1');

      expect(WorkflowTemplate.find).toHaveBeenCalledWith(
        expect.objectContaining({
          'steps.email_template_version_id': { $in: [{ toString: expect.any(Function) }, { toString: expect.any(Function) }] },
        }),
      );
      expect(usages).toEqual([
        {
          workflowTemplateId: 'wt-1',
          workflowTemplateName: 'Cold outreach — FedEx ISP',
          workflowType: 'cold_outreach',
          stepIndex: 1,
          emailTemplateVersionId: 'ver-1',
          versionNumber: 1,
        },
        {
          workflowTemplateId: 'wt-1',
          workflowTemplateName: 'Cold outreach — FedEx ISP',
          workflowType: 'cold_outreach',
          stepIndex: 2,
          emailTemplateVersionId: 'ver-2',
          versionNumber: 2,
        },
        {
          workflowTemplateId: 'wt-2',
          workflowTemplateName: 'Win-back',
          workflowType: null,
          stepIndex: 0,
          emailTemplateVersionId: 'ver-1',
          versionNumber: 1,
        },
      ]);
    });

    it('skips non-email steps (no email_template_version_id) without erroring', async () => {
      (EmailTemplateVersion.find as jest.Mock).mockReturnValue(
        selectLean([{ _id: { toString: () => 'ver-1' }, version_number: 1 }]),
      );
      (WorkflowTemplate.find as jest.Mock).mockReturnValue(
        selectLean([
          {
            _id: { toString: () => 'wt-1' },
            name: 'Cold outreach',
            workflow_type: 'cold_outreach',
            steps: [{ kind: 'wait' }, { kind: 'call_task' }],
          },
        ]),
      );

      const usages = await listEmailTemplateUsages('tpl-1');

      expect(usages).toEqual([]);
    });

    it('propagates EmailTemplateNotFoundError when the template does not exist', async () => {
      (EmailTemplate.findById as jest.Mock).mockResolvedValue(null);
      await expect(listEmailTemplateUsages('missing')).rejects.toThrow(EmailTemplateNotFoundError);
    });
  });
});

import type { Request, Response } from 'express';

jest.mock('../../src/services/emailTemplate.service', () => ({
  getEmailTemplate: jest.fn(),
  listEmailTemplatesForOrg: jest.fn(),
  listEmailTemplateUsages: jest.fn(),
}));
jest.mock('../../src/services/emailTemplateVersion.service', () => ({
  EmailTemplateNotFoundError: jest.requireActual('../../src/services/emailTemplateVersion.service')
    .EmailTemplateNotFoundError,
  listEmailTemplateVersions: jest.fn(),
}));

import {
  getEmailTemplate,
  listEmailTemplatesForOrg,
  listEmailTemplateUsages,
} from '../../src/services/emailTemplate.service';
import {
  EmailTemplateNotFoundError,
  listEmailTemplateVersions,
} from '../../src/services/emailTemplateVersion.service';
import {
  listEmailTemplateUsagesHandler,
  listEmailTemplateVersionsHandler,
  listEmailTemplatesHandler,
} from '../../src/routes/emailTemplate.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('emailTemplate.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('listEmailTemplatesHandler', () => {
    it('lists templates for the org param with no filters when none are given', async () => {
      (listEmailTemplatesForOrg as jest.Mock).mockResolvedValue([{ _id: 'tpl-1' }]);
      const req = { params: { orgId: 'org-1' }, query: {} } as unknown as Request;
      const res = mockRes();

      await listEmailTemplatesHandler(req, res, jest.fn());

      expect(listEmailTemplatesForOrg).toHaveBeenCalledWith('org-1', {
        persona: undefined,
        workflowPosition: undefined,
        intendedWorkflowType: undefined,
        status: undefined,
      });
      expect(res.json).toHaveBeenCalledWith([{ _id: 'tpl-1' }]);
    });

    it('parses persona/workflow_position/intended_workflow_type/status query filters', async () => {
      (listEmailTemplatesForOrg as jest.Mock).mockResolvedValue([]);
      const req = {
        params: { orgId: 'org-1' },
        query: {
          persona: 'fedex_isp',
          workflow_position: 'cold_open',
          intended_workflow_type: 'cold_outreach',
          status: 'APPROVED',
        },
      } as unknown as Request;
      const res = mockRes();

      await listEmailTemplatesHandler(req, res, jest.fn());

      expect(listEmailTemplatesForOrg).toHaveBeenCalledWith('org-1', {
        persona: 'fedex_isp',
        workflowPosition: 'cold_open',
        intendedWorkflowType: 'cold_outreach',
        status: 'APPROVED',
      });
    });

    it('ignores an invalid status filter value, same as the versions endpoint', async () => {
      (listEmailTemplatesForOrg as jest.Mock).mockResolvedValue([]);
      const req = {
        params: { orgId: 'org-1' },
        query: { status: 'not-a-real-status' },
      } as unknown as Request;
      const res = mockRes();

      await listEmailTemplatesHandler(req, res, jest.fn());

      expect(listEmailTemplatesForOrg).toHaveBeenCalledWith(
        'org-1',
        expect.objectContaining({ status: undefined }),
      );
    });

    it('ignores an empty-string filter value', async () => {
      (listEmailTemplatesForOrg as jest.Mock).mockResolvedValue([]);
      const req = { params: { orgId: 'org-1' }, query: { persona: '' } } as unknown as Request;
      const res = mockRes();

      await listEmailTemplatesHandler(req, res, jest.fn());

      expect(listEmailTemplatesForOrg).toHaveBeenCalledWith('org-1', expect.objectContaining({ persona: undefined }));
    });
  });

  describe('listEmailTemplateUsagesHandler', () => {
    it('404s (via next) when the template belongs to a different org', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-2' },
      });
      const req = { params: { orgId: 'org-1', templateId: 'tpl-1' }, query: {} } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await listEmailTemplateUsagesHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(EmailTemplateNotFoundError));
      expect(listEmailTemplateUsages).not.toHaveBeenCalled();
    });

    it('returns the usages mapped to the response DTO shape', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (listEmailTemplateUsages as jest.Mock).mockResolvedValue([
        {
          workflowTemplateId: 'wt-1',
          workflowTemplateName: 'Cold outreach — FedEx ISP',
          workflowType: 'cold_outreach',
          stepIndex: 0,
          emailTemplateVersionId: 'ver-1',
          versionNumber: 2,
        },
      ]);
      const req = { params: { orgId: 'org-1', templateId: 'tpl-1' }, query: {} } as unknown as Request;
      const res = mockRes();

      await listEmailTemplateUsagesHandler(req, res, jest.fn());

      expect(listEmailTemplateUsages).toHaveBeenCalledWith('tpl-1');
      expect(res.json).toHaveBeenCalledWith([
        {
          workflow_template_id: 'wt-1',
          workflow_template_name: 'Cold outreach — FedEx ISP',
          workflow_type: 'cold_outreach',
          step_index: 0,
          email_template_version_id: 'ver-1',
          version_number: 2,
        },
      ]);
    });
  });

  describe('listEmailTemplateVersionsHandler', () => {
    it('404s (via next) when the template belongs to a different org', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-2' },
      });
      const req = { params: { orgId: 'org-1', templateId: 'tpl-1' }, query: {} } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await listEmailTemplateVersionsHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(EmailTemplateNotFoundError));
      expect(listEmailTemplateVersions).not.toHaveBeenCalled();
    });

    it('lists only APPROVED versions when status=APPROVED is passed', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (listEmailTemplateVersions as jest.Mock).mockResolvedValue([{ _id: 'ver-1', status: 'APPROVED' }]);

      const req = {
        params: { orgId: 'org-1', templateId: 'tpl-1' },
        query: { status: 'APPROVED' },
      } as unknown as Request;
      const res = mockRes();

      await listEmailTemplateVersionsHandler(req, res, jest.fn());

      expect(listEmailTemplateVersions).toHaveBeenCalledWith('tpl-1', 'APPROVED');
      expect(res.json).toHaveBeenCalledWith([{ _id: 'ver-1', status: 'APPROVED' }]);
    });

    it('ignores an invalid status query value', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (listEmailTemplateVersions as jest.Mock).mockResolvedValue([]);

      const req = {
        params: { orgId: 'org-1', templateId: 'tpl-1' },
        query: { status: 'not-a-real-status' },
      } as unknown as Request;
      const res = mockRes();

      await listEmailTemplateVersionsHandler(req, res, jest.fn());

      expect(listEmailTemplateVersions).toHaveBeenCalledWith('tpl-1', undefined);
    });
  });
});

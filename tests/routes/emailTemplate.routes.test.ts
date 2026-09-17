import type { Request, Response } from 'express';

jest.mock('../../src/services/emailTemplate.service', () => ({
  getEmailTemplate: jest.fn(),
  listEmailTemplatesForOrg: jest.fn(),
  listEmailTemplateUsages: jest.fn(),
}));
jest.mock('../../src/services/emailTemplateVersion.service', () => ({
  EmailTemplateNotFoundError: jest.requireActual('../../src/services/emailTemplateVersion.service')
    .EmailTemplateNotFoundError,
  EmailTemplateVersionNotFoundError: jest.requireActual('../../src/services/emailTemplateVersion.service')
    .EmailTemplateVersionNotFoundError,
  listEmailTemplateVersions: jest.fn(),
  getEmailTemplateVersion: jest.fn(),
  approveVersion: jest.fn(),
  rejectVersion: jest.fn(),
  resubmitVersion: jest.fn(),
  submitForReview: jest.fn(),
  createAiDraftVersion: jest.fn(),
}));

import {
  getEmailTemplate,
  listEmailTemplatesForOrg,
  listEmailTemplateUsages,
} from '../../src/services/emailTemplate.service';
import {
  EmailTemplateNotFoundError,
  EmailTemplateVersionNotFoundError,
  listEmailTemplateVersions,
  getEmailTemplateVersion,
  approveVersion,
  rejectVersion,
  resubmitVersion,
  submitForReview,
  createAiDraftVersion,
} from '../../src/services/emailTemplateVersion.service';
import {
  listEmailTemplateUsagesHandler,
  listEmailTemplateVersionsHandler,
  listEmailTemplatesHandler,
  approveEmailTemplateVersionHandler,
  rejectEmailTemplateVersionHandler,
  resubmitEmailTemplateVersionHandler,
  createAiDraftEmailTemplateVersionHandler,
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

  function versionReq(overrides: Record<string, unknown> = {}) {
    return {
      params: { orgId: 'org-1', templateId: 'tpl-1', versionId: 'ver-1' },
      query: {},
      body: {},
      user: { id: 'user-1' },
      orgAccess: { roles: ['BD_MANAGER'] },
      ...overrides,
    } as unknown as Request;
  }

  describe('approveEmailTemplateVersionHandler', () => {
    it('404s (via next) when the version belongs to a different template', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (getEmailTemplateVersion as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'ver-1' },
        email_template_id: { toString: () => 'tpl-2' },
      });
      const req = versionReq();
      const next = jest.fn();

      await approveEmailTemplateVersionHandler(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(EmailTemplateVersionNotFoundError));
      expect(approveVersion).not.toHaveBeenCalled();
    });

    it('approves using a role picked from the caller\'s TEMPLATE_APPROVER_ROLES-qualifying roles', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (getEmailTemplateVersion as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'ver-1' },
        email_template_id: { toString: () => 'tpl-1' },
      });
      (approveVersion as jest.Mock).mockResolvedValue({ _id: 'ver-1', status: 'APPROVED' });
      const res = mockRes();

      await approveEmailTemplateVersionHandler(versionReq({ orgAccess: { roles: ['BD_LEAD_GEN', 'BD_MANAGER'] } }), res, jest.fn());

      expect(approveVersion).toHaveBeenCalledWith('ver-1', 'user-1', 'BD_MANAGER');
      expect(res.json).toHaveBeenCalledWith({ _id: 'ver-1', status: 'APPROVED' });
    });
  });

  describe('rejectEmailTemplateVersionHandler', () => {
    it('responds 400 without calling rejectVersion when reason is missing', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (getEmailTemplateVersion as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'ver-1' },
        email_template_id: { toString: () => 'tpl-1' },
      });
      const res = mockRes();

      await rejectEmailTemplateVersionHandler(versionReq({ body: {} }), res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(rejectVersion).not.toHaveBeenCalled();
    });

    it('responds 400 when reason is only whitespace', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (getEmailTemplateVersion as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'ver-1' },
        email_template_id: { toString: () => 'tpl-1' },
      });
      const res = mockRes();

      await rejectEmailTemplateVersionHandler(versionReq({ body: { reason: '   ' } }), res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(rejectVersion).not.toHaveBeenCalled();
    });

    it('rejects with the trimmed reason and the picked approver role', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (getEmailTemplateVersion as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'ver-1' },
        email_template_id: { toString: () => 'tpl-1' },
      });
      (rejectVersion as jest.Mock).mockResolvedValue({ _id: 'ver-1', status: 'REJECTED' });
      const res = mockRes();

      await rejectEmailTemplateVersionHandler(versionReq({ body: { reason: '  too generic  ' } }), res, jest.fn());

      expect(rejectVersion).toHaveBeenCalledWith('ver-1', 'user-1', 'BD_MANAGER', 'too generic');
      expect(res.json).toHaveBeenCalledWith({ _id: 'ver-1', status: 'REJECTED' });
    });
  });

  describe('resubmitEmailTemplateVersionHandler', () => {
    it('404s (via next) when the version belongs to a different template', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (getEmailTemplateVersion as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'ver-1' },
        email_template_id: { toString: () => 'tpl-2' },
      });
      const next = jest.fn();

      await resubmitEmailTemplateVersionHandler(versionReq(), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(EmailTemplateVersionNotFoundError));
      expect(resubmitVersion).not.toHaveBeenCalled();
      expect(submitForReview).not.toHaveBeenCalled();
    });

    it('chains resubmitVersion then submitForReview and returns the resubmitted version', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (getEmailTemplateVersion as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'ver-1' },
        email_template_id: { toString: () => 'tpl-1' },
      });
      (resubmitVersion as jest.Mock).mockResolvedValue({ _id: 'ver-1', status: 'RESUBMITTED' });
      (submitForReview as jest.Mock).mockResolvedValue({ _id: 'ver-1', status: 'PENDING_APPROVAL' });
      const res = mockRes();

      await resubmitEmailTemplateVersionHandler(
        versionReq({ body: { subject_line: 'New subject' } }),
        res,
        jest.fn(),
      );

      expect(resubmitVersion).toHaveBeenCalledWith('ver-1', { subjectLine: 'New subject', bodyHtml: undefined });
      expect(submitForReview).toHaveBeenCalledWith('ver-1', 'user-1');
      expect(res.json).toHaveBeenCalledWith({ _id: 'ver-1', status: 'PENDING_APPROVAL' });
    });
  });

  describe('createAiDraftEmailTemplateVersionHandler', () => {
    function draftReq(overrides: Record<string, unknown> = {}) {
      return {
        params: { orgId: 'org-1', templateId: 'tpl-1' },
        query: {},
        body: { brief: 'Announce the new self-serve tier' },
        user: { id: 'user-1' },
        orgAccess: { roles: ['BD_MARKETING'] },
        ...overrides,
      } as unknown as Request;
    }

    it('404s (via next) when the template belongs to a different org', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-2' },
      });
      const next = jest.fn();

      await createAiDraftEmailTemplateVersionHandler(draftReq(), mockRes(), next);

      expect(next).toHaveBeenCalledWith(expect.any(EmailTemplateNotFoundError));
      expect(createAiDraftVersion).not.toHaveBeenCalled();
    });

    it('responds 400 without calling createAiDraftVersion when brief is missing', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      const res = mockRes();

      await createAiDraftEmailTemplateVersionHandler(draftReq({ body: {} }), res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createAiDraftVersion).not.toHaveBeenCalled();
    });

    it('responds 400 when brief is only whitespace', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      const res = mockRes();

      await createAiDraftEmailTemplateVersionHandler(draftReq({ body: { brief: '   ' } }), res, jest.fn());

      expect(res.status).toHaveBeenCalledWith(400);
      expect(createAiDraftVersion).not.toHaveBeenCalled();
    });

    it('folds persona/workflow_position into the instructions and creates a new_template draft', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (createAiDraftVersion as jest.Mock).mockResolvedValue({ _id: 'ver-9', status: 'DRAFT' });
      const res = mockRes();

      await createAiDraftEmailTemplateVersionHandler(
        draftReq({
          body: {
            persona: 'fedex_isp',
            workflow_position: 'cold_open',
            brief: 'Announce the new self-serve tier',
          },
        }),
        res,
        jest.fn(),
      );

      expect(createAiDraftVersion).toHaveBeenCalledWith('tpl-1', {
        type: 'new_template',
        instructions: 'Persona: fedex_isp. Workflow position: cold_open. Announce the new self-serve tier',
      });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ _id: 'ver-9', status: 'DRAFT' });
    });

    it('uses the brief alone as instructions when persona/workflow_position are omitted', async () => {
      (getEmailTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (createAiDraftVersion as jest.Mock).mockResolvedValue({ _id: 'ver-9', status: 'DRAFT' });

      await createAiDraftEmailTemplateVersionHandler(draftReq(), mockRes(), jest.fn());

      expect(createAiDraftVersion).toHaveBeenCalledWith('tpl-1', {
        type: 'new_template',
        instructions: 'Announce the new self-serve tier',
      });
    });
  });
});

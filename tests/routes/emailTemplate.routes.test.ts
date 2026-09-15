import type { Request, Response } from 'express';

jest.mock('../../src/services/emailTemplate.service', () => ({
  getEmailTemplate: jest.fn(),
  listEmailTemplatesForOrg: jest.fn(),
}));
jest.mock('../../src/services/emailTemplateVersion.service', () => ({
  EmailTemplateNotFoundError: jest.requireActual('../../src/services/emailTemplateVersion.service')
    .EmailTemplateNotFoundError,
  listEmailTemplateVersions: jest.fn(),
}));

import { getEmailTemplate, listEmailTemplatesForOrg } from '../../src/services/emailTemplate.service';
import {
  EmailTemplateNotFoundError,
  listEmailTemplateVersions,
} from '../../src/services/emailTemplateVersion.service';
import {
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
    it('lists templates for the org param', async () => {
      (listEmailTemplatesForOrg as jest.Mock).mockResolvedValue([{ _id: 'tpl-1' }]);
      const req = { params: { orgId: 'org-1' } } as unknown as Request;
      const res = mockRes();

      await listEmailTemplatesHandler(req, res, jest.fn());

      expect(listEmailTemplatesForOrg).toHaveBeenCalledWith('org-1');
      expect(res.json).toHaveBeenCalledWith([{ _id: 'tpl-1' }]);
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

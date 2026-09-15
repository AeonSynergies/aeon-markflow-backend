import type { Request, Response } from 'express';

jest.mock('../../src/services/workflowTemplate.service', () => ({
  WorkflowTemplateNotFoundError: jest.requireActual('../../src/services/workflowTemplate.service')
    .WorkflowTemplateNotFoundError,
  createWorkflowTemplate: jest.fn(),
  getWorkflowTemplate: jest.fn(),
  listWorkflowTemplatesForOrg: jest.fn(),
  updateWorkflowTemplate: jest.fn(),
}));
jest.mock('../../src/services/enrollment.service', () => ({ enrollSavedList: jest.fn() }));

import { enrollSavedList } from '../../src/services/enrollment.service';
import {
  createWorkflowTemplate,
  getWorkflowTemplate,
  listWorkflowTemplatesForOrg,
  updateWorkflowTemplate,
  WorkflowTemplateNotFoundError,
} from '../../src/services/workflowTemplate.service';
import {
  createWorkflowTemplateHandler,
  enrollSavedListHandler,
  getWorkflowTemplateHandler,
  listWorkflowTemplatesHandler,
  updateWorkflowTemplateHandler,
} from '../../src/routes/workflowTemplate.routes';

function mockRes() {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('workflowTemplate.routes handlers', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createWorkflowTemplateHandler', () => {
    it('creates a template scoped to the org param and returns 201', async () => {
      (createWorkflowTemplate as jest.Mock).mockResolvedValue({ _id: 'tpl-1', name: 'x' });
      const req = { params: { orgId: 'org-1' }, body: { name: 'x', steps: [] } } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await createWorkflowTemplateHandler(req, res, next);

      expect(createWorkflowTemplate).toHaveBeenCalledWith('org-1', { name: 'x', steps: [] });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(next).not.toHaveBeenCalled();
    });

    it('forwards a service error to next', async () => {
      const error = new Error('boom');
      (createWorkflowTemplate as jest.Mock).mockRejectedValue(error);
      const req = { params: { orgId: 'org-1' }, body: {} } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await createWorkflowTemplateHandler(req, res, next);
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('listWorkflowTemplatesHandler', () => {
    it('lists templates for the org param', async () => {
      (listWorkflowTemplatesForOrg as jest.Mock).mockResolvedValue([{ _id: 'tpl-1' }]);
      const req = { params: { orgId: 'org-1' } } as unknown as Request;
      const res = mockRes();

      await listWorkflowTemplatesHandler(req, res, jest.fn());

      expect(listWorkflowTemplatesForOrg).toHaveBeenCalledWith('org-1');
      expect(res.json).toHaveBeenCalledWith([{ _id: 'tpl-1' }]);
    });
  });

  describe('getWorkflowTemplateHandler', () => {
    it('404s (via next) when the template belongs to a different org', async () => {
      (getWorkflowTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-2' },
      });
      const req = { params: { orgId: 'org-1', templateId: 'tpl-1' } } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await getWorkflowTemplateHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(WorkflowTemplateNotFoundError));
    });

    it('returns the template when it belongs to the org', async () => {
      (getWorkflowTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
        name: 'x',
      });
      const req = { params: { orgId: 'org-1', templateId: 'tpl-1' } } as unknown as Request;
      const res = mockRes();

      await getWorkflowTemplateHandler(req, res, jest.fn());

      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'x' }));
    });
  });

  describe('updateWorkflowTemplateHandler', () => {
    it('applies the update when the template belongs to the org', async () => {
      const template = { _id: { toString: () => 'tpl-1' }, org_id: { toString: () => 'org-1' } };
      (getWorkflowTemplate as jest.Mock).mockResolvedValue(template);
      (updateWorkflowTemplate as jest.Mock).mockResolvedValue({ ...template, name: 'renamed' });

      const req = {
        params: { orgId: 'org-1', templateId: 'tpl-1' },
        body: { name: 'renamed' },
      } as unknown as Request;
      const res = mockRes();

      await updateWorkflowTemplateHandler(req, res, jest.fn());

      expect(updateWorkflowTemplate).toHaveBeenCalledWith('tpl-1', { name: 'renamed' });
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ name: 'renamed' }));
    });
  });

  describe('enrollSavedListHandler', () => {
    it('enrolls the saved list and returns 201 with the summary', async () => {
      (getWorkflowTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-1' },
      });
      (enrollSavedList as jest.Mock).mockResolvedValue({
        enrolledCount: 2,
        skippedCount: 1,
        enrollmentIds: ['enr-1', 'enr-2'],
      });

      const req = {
        params: { orgId: 'org-1', templateId: 'tpl-1' },
        body: { saved_list_id: 'list-1' },
      } as unknown as Request;
      const res = mockRes();

      await enrollSavedListHandler(req, res, jest.fn());

      expect(enrollSavedList).toHaveBeenCalledWith('tpl-1', 'list-1');
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        enrolled_count: 2,
        skipped_count: 1,
        enrollment_ids: ['enr-1', 'enr-2'],
      });
    });

    it('forwards a cross-org template lookup as not-found via next', async () => {
      (getWorkflowTemplate as jest.Mock).mockResolvedValue({
        _id: { toString: () => 'tpl-1' },
        org_id: { toString: () => 'org-2' },
      });
      const req = {
        params: { orgId: 'org-1', templateId: 'tpl-1' },
        body: { saved_list_id: 'list-1' },
      } as unknown as Request;
      const res = mockRes();
      const next = jest.fn();

      await enrollSavedListHandler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(WorkflowTemplateNotFoundError));
      expect(enrollSavedList).not.toHaveBeenCalled();
    });
  });
});

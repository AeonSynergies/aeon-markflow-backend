jest.mock('../../src/models/WorkflowTemplate.model', () => ({
  WorkflowTemplate: { create: jest.fn(), findById: jest.fn(), find: jest.fn() },
}));

import { WorkflowTemplate } from '../../src/models/WorkflowTemplate.model';
import {
  WorkflowTemplateNotFoundError,
  createWorkflowTemplate,
  getWorkflowTemplate,
  listWorkflowTemplatesForOrg,
  updateWorkflowTemplate,
} from '../../src/services/workflowTemplate.service';

describe('workflowTemplate.service', () => {
  afterEach(() => jest.clearAllMocks());

  describe('createWorkflowTemplate', () => {
    it('creates with defaulted requires_warmup', async () => {
      (WorkflowTemplate.create as jest.Mock).mockResolvedValue({ _id: 'tpl-1' });

      await createWorkflowTemplate('org-1', { name: 'Cadence', steps: [] });

      expect(WorkflowTemplate.create).toHaveBeenCalledWith({
        org_id: 'org-1',
        name: 'Cadence',
        requires_warmup: false,
        steps: [],
      });
    });

    it('respects an explicit requires_warmup', async () => {
      (WorkflowTemplate.create as jest.Mock).mockResolvedValue({ _id: 'tpl-1' });
      await createWorkflowTemplate('org-1', { name: 'Cadence', requires_warmup: true, steps: [] });
      expect(WorkflowTemplate.create).toHaveBeenCalledWith(expect.objectContaining({ requires_warmup: true }));
    });
  });

  describe('getWorkflowTemplate', () => {
    it('throws WorkflowTemplateNotFoundError when missing', async () => {
      (WorkflowTemplate.findById as jest.Mock).mockResolvedValue(null);
      await expect(getWorkflowTemplate('missing')).rejects.toThrow(WorkflowTemplateNotFoundError);
    });

    it('returns the template when found', async () => {
      (WorkflowTemplate.findById as jest.Mock).mockResolvedValue({ _id: 'tpl-1' });
      await expect(getWorkflowTemplate('tpl-1')).resolves.toEqual({ _id: 'tpl-1' });
    });
  });

  describe('updateWorkflowTemplate', () => {
    it('applies only the provided fields and replaces steps via .set()', async () => {
      const set = jest.fn();
      const save = jest.fn().mockResolvedValue(undefined);
      (WorkflowTemplate.findById as jest.Mock).mockResolvedValue({
        name: 'old',
        requires_warmup: false,
        set,
        save,
      });

      const newSteps = [{ kind: 'wait' as const, wait_amount: 1, wait_unit: 'days' as const }];
      const result = await updateWorkflowTemplate('tpl-1', { name: 'new', steps: newSteps });

      expect(result.name).toBe('new');
      expect(set).toHaveBeenCalledWith('steps', newSteps);
      expect(save).toHaveBeenCalled();
    });

    it('throws WorkflowTemplateNotFoundError when missing', async () => {
      (WorkflowTemplate.findById as jest.Mock).mockResolvedValue(null);
      await expect(updateWorkflowTemplate('missing', { name: 'x' })).rejects.toThrow(
        WorkflowTemplateNotFoundError,
      );
    });
  });

  describe('listWorkflowTemplatesForOrg', () => {
    it('queries by org_id, newest first', async () => {
      const sort = jest.fn().mockResolvedValue([{ _id: 'tpl-1' }]);
      (WorkflowTemplate.find as jest.Mock).mockReturnValue({ sort });

      const result = await listWorkflowTemplatesForOrg('org-1');

      expect(WorkflowTemplate.find).toHaveBeenCalledWith({ org_id: 'org-1' });
      expect(sort).toHaveBeenCalledWith({ createdAt: -1 });
      expect(result).toEqual([{ _id: 'tpl-1' }]);
    });
  });
});

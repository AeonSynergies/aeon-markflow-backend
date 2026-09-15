jest.mock('../../src/models/Enrollment.model', () => ({ Enrollment: { create: jest.fn() } }));
jest.mock('../../src/models/SavedList.model', () => ({ SavedList: { findById: jest.fn() } }));
jest.mock('../../src/queues/enrollmentQueue', () => ({ enqueueStepJob: jest.fn() }));
jest.mock('../../src/services/workflowTemplate.service', () => ({
  ...jest.requireActual('../../src/services/workflowTemplate.service'),
  getWorkflowTemplate: jest.fn(),
}));

import { Enrollment } from '../../src/models/Enrollment.model';
import { SavedList } from '../../src/models/SavedList.model';
import { enqueueStepJob } from '../../src/queues/enrollmentQueue';
import {
  CrossOrgReferenceError,
  EmptyWorkflowTemplateError,
  SavedListNotFoundError,
  enrollSavedList,
} from '../../src/services/enrollment.service';
import { getWorkflowTemplate } from '../../src/services/workflowTemplate.service';

function mockTemplate(overrides: Record<string, unknown> = {}) {
  (getWorkflowTemplate as jest.Mock).mockResolvedValue({
    _id: { toString: () => 'tpl-1' },
    org_id: { toString: () => 'org-1' },
    steps: [{ kind: 'wait', wait_amount: 1, wait_unit: 'days' }],
    ...overrides,
  });
}

describe('enrollment.service enrollSavedList', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws EmptyWorkflowTemplateError when the template has no steps', async () => {
    mockTemplate({ steps: [] });
    await expect(enrollSavedList('tpl-1', 'list-1')).rejects.toThrow(EmptyWorkflowTemplateError);
    expect(SavedList.findById).not.toHaveBeenCalled();
  });

  it('throws SavedListNotFoundError when the list does not exist', async () => {
    mockTemplate();
    (SavedList.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    await expect(enrollSavedList('tpl-1', 'missing')).rejects.toThrow(SavedListNotFoundError);
  });

  it('throws CrossOrgReferenceError when the list belongs to a different org', async () => {
    mockTemplate();
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ org_id: { toString: () => 'org-2' }, lead_ids: [] }),
    });
    await expect(enrollSavedList('tpl-1', 'list-1')).rejects.toThrow(CrossOrgReferenceError);
  });

  it('creates one enrollment per lead and enqueues its first step', async () => {
    mockTemplate();
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        org_id: { toString: () => 'org-1' },
        lead_ids: ['lead-1', 'lead-2'],
      }),
    });
    (Enrollment.create as jest.Mock)
      .mockResolvedValueOnce({ _id: { toString: () => 'enr-1' } })
      .mockResolvedValueOnce({ _id: { toString: () => 'enr-2' } });

    const result = await enrollSavedList('tpl-1', 'list-1');

    expect(Enrollment.create).toHaveBeenNthCalledWith(1, {
      lead_id: 'lead-1',
      workflow_template_id: { toString: expect.any(Function) },
      steps: [{ kind: 'wait', wait_amount: 1, wait_unit: 'days' }],
      current_step_index: 0,
      status: 'active',
    });
    expect(enqueueStepJob).toHaveBeenNthCalledWith(1, 'enr-1', 0, 0);
    expect(enqueueStepJob).toHaveBeenNthCalledWith(2, 'enr-2', 0, 0);
    expect(result).toEqual({ enrolledCount: 2, skippedCount: 0, enrollmentIds: ['enr-1', 'enr-2'] });
  });

  it('skips a lead that already has an active enrollment (duplicate key) without failing the batch', async () => {
    mockTemplate();
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({
        org_id: { toString: () => 'org-1' },
        lead_ids: ['lead-1', 'lead-2'],
      }),
    });
    const duplicateError = Object.assign(new Error('duplicate'), { code: 11000 });
    (Enrollment.create as jest.Mock)
      .mockRejectedValueOnce(duplicateError)
      .mockResolvedValueOnce({ _id: { toString: () => 'enr-2' } });

    const result = await enrollSavedList('tpl-1', 'list-1');

    expect(result).toEqual({ enrolledCount: 1, skippedCount: 1, enrollmentIds: ['enr-2'] });
    expect(enqueueStepJob).toHaveBeenCalledTimes(1);
  });

  it('propagates a non-duplicate-key error', async () => {
    mockTemplate();
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ org_id: { toString: () => 'org-1' }, lead_ids: ['lead-1'] }),
    });
    (Enrollment.create as jest.Mock).mockRejectedValueOnce(new Error('mongo down'));

    await expect(enrollSavedList('tpl-1', 'list-1')).rejects.toThrow('mongo down');
  });
});

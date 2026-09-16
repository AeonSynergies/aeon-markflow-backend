jest.mock('../../src/models/Enrollment.model', () => ({
  Enrollment: { create: jest.fn(), findById: jest.fn(), find: jest.fn() },
}));
jest.mock('../../src/models/Organization.model', () => ({ Organization: { findById: jest.fn() } }));
jest.mock('../../src/models/SavedList.model', () => ({ SavedList: { findById: jest.fn() } }));
jest.mock('../../src/queues/enrollmentQueue', () => ({ enqueueStepJob: jest.fn() }));
jest.mock('../../src/services/workflowTemplate.service', () => ({
  ...jest.requireActual('../../src/services/workflowTemplate.service'),
  getWorkflowTemplate: jest.fn(),
}));
jest.mock('../../src/services/domainRouter.service', () => ({ assignMailboxesForDomains: jest.fn() }));
jest.mock('../../src/services/abTesting.service', () => ({
  resolveStepForEnrollment: jest.fn((step) => Promise.resolve(step)),
}));

import { Enrollment } from '../../src/models/Enrollment.model';
import { Organization } from '../../src/models/Organization.model';
import { SavedList } from '../../src/models/SavedList.model';
import { enqueueStepJob } from '../../src/queues/enrollmentQueue';
import { assignMailboxesForDomains } from '../../src/services/domainRouter.service';
import {
  CrossOrgReferenceError,
  EmptyWorkflowTemplateError,
  OrganizationNotFoundError,
  SavedListNotFoundError,
  enrollSavedList,
  exitAllActiveEnrollmentsForLead,
  exitEnrollment,
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

function mockOrg(overrides: Record<string, unknown> = {}) {
  (Organization.findById as jest.Mock).mockReturnValue({
    lean: jest.fn().mockResolvedValue({ _id: { toString: () => 'org-1' }, send_time_strategy: 'manual', ...overrides }),
  });
}

describe('enrollment.service enrollSavedList', () => {
  beforeEach(() => {
    mockOrg();
    (assignMailboxesForDomains as jest.Mock).mockResolvedValue([]);
  });
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
      requires_warmup: false,
      workflow_type: null,
      send_time_strategy: 'manual',
      assigned_mailboxes: [],
      current_step_index: 0,
      status: 'active',
    });
    expect(enqueueStepJob).toHaveBeenNthCalledWith(1, 'enr-1', 0, 0);
    expect(enqueueStepJob).toHaveBeenNthCalledWith(2, 'enr-2', 0, 0);
    expect(result).toEqual({ enrolledCount: 2, skippedCount: 0, enrollmentIds: ['enr-1', 'enr-2'] });
  });

  it('assigns one mailbox per distinct sending_domain among the steps, once, and snapshots it onto the enrollment', async () => {
    mockTemplate({
      steps: [
        { kind: 'email', email_template_version_id: 'ver-1', sending_domain: 'aeonsign.com' },
        { kind: 'wait', wait_amount: 1, wait_unit: 'days' },
        { kind: 'email', email_template_version_id: 'ver-2', sending_domain: 'aeonsign.com' },
      ],
    });
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ org_id: { toString: () => 'org-1' }, lead_ids: ['lead-1'] }),
    });
    (assignMailboxesForDomains as jest.Mock).mockResolvedValue([{ domain: 'aeonsign.com', mailbox: 'alex@aeonsign.com' }]);
    (Enrollment.create as jest.Mock).mockResolvedValueOnce({ _id: { toString: () => 'enr-1' } });

    await enrollSavedList('tpl-1', 'list-1');

    // Called once per lead — not once per email step — with every email step's domain
    // (assignMailboxesForDomains itself dedupes repeats; see domainRouter.service.test.ts).
    expect(assignMailboxesForDomains).toHaveBeenCalledTimes(1);
    expect(assignMailboxesForDomains).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { toString: expect.any(Function) } }),
      ['aeonsign.com', 'aeonsign.com'],
      'marketing',
    );
    expect(Enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ assigned_mailboxes: [{ domain: 'aeonsign.com', mailbox: 'alex@aeonsign.com' }] }),
    );
  });

  it('does not call assignMailboxesForDomains when the template has no email steps', async () => {
    mockTemplate({ steps: [{ kind: 'call_task', call_task_instructions: 'Discovery call' }] });
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ org_id: { toString: () => 'org-1' }, lead_ids: ['lead-1'] }),
    });
    (Enrollment.create as jest.Mock).mockResolvedValueOnce({ _id: { toString: () => 'enr-1' } });

    await enrollSavedList('tpl-1', 'list-1');

    expect(assignMailboxesForDomains).toHaveBeenCalledWith(expect.anything(), [], 'marketing');
    expect(Enrollment.create).toHaveBeenCalledWith(expect.objectContaining({ assigned_mailboxes: [] }));
  });

  it('snapshots requires_warmup: true from the template onto each enrollment', async () => {
    mockTemplate({ requires_warmup: true });
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ org_id: { toString: () => 'org-1' }, lead_ids: ['lead-1'] }),
    });
    (Enrollment.create as jest.Mock).mockResolvedValueOnce({ _id: { toString: () => 'enr-1' } });

    await enrollSavedList('tpl-1', 'list-1');

    expect(Enrollment.create).toHaveBeenCalledWith(expect.objectContaining({ requires_warmup: true }));
  });

  it('snapshots workflow_type from the template and send_time_strategy from the org onto each enrollment', async () => {
    mockTemplate({ workflow_type: 'cold_outreach' });
    mockOrg({ send_time_strategy: 'ai_suggested' });
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ org_id: { toString: () => 'org-1' }, lead_ids: ['lead-1'] }),
    });
    (Enrollment.create as jest.Mock).mockResolvedValueOnce({ _id: { toString: () => 'enr-1' } });

    await enrollSavedList('tpl-1', 'list-1');

    expect(Enrollment.create).toHaveBeenCalledWith(
      expect.objectContaining({ workflow_type: 'cold_outreach', send_time_strategy: 'ai_suggested' }),
    );
  });

  it('throws OrganizationNotFoundError when the template references a missing org', async () => {
    mockTemplate();
    (Organization.findById as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
    (SavedList.findById as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue({ org_id: { toString: () => 'org-1' }, lead_ids: ['lead-1'] }),
    });

    await expect(enrollSavedList('tpl-1', 'list-1')).rejects.toThrow(OrganizationNotFoundError);
    expect(Enrollment.create).not.toHaveBeenCalled();
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

describe('exitEnrollment', () => {
  afterEach(() => jest.clearAllMocks());

  function mockActiveEnrollment(overrides: Record<string, unknown> = {}) {
    const doc: Record<string, unknown> = { status: 'active', save: jest.fn().mockResolvedValue(undefined), ...overrides };
    (Enrollment.findById as jest.Mock).mockResolvedValue(doc);
    return doc;
  }

  it('exits an active enrollment, setting status, exit_reason, and completed_at', async () => {
    const doc = mockActiveEnrollment();

    await exitEnrollment('enr-1', 'reply_interested');

    expect(Enrollment.findById).toHaveBeenCalledWith('enr-1');
    expect(doc.status).toBe('exited');
    expect(doc.exit_reason).toBe('reply_interested');
    expect(doc.completed_at).toBeInstanceOf(Date);
    expect(doc.save).toHaveBeenCalled();
  });

  it('no-ops when the enrollment does not exist', async () => {
    (Enrollment.findById as jest.Mock).mockResolvedValue(null);
    await expect(exitEnrollment('missing', 'reply_interested')).resolves.toBeUndefined();
  });

  it('no-ops (idempotent) when the enrollment is not currently active', async () => {
    const doc = mockActiveEnrollment({ status: 'completed' });

    await exitEnrollment('enr-1', 'reply_interested');

    expect(doc.status).toBe('completed');
    expect(doc.save).not.toHaveBeenCalled();
  });
});

describe('exitAllActiveEnrollmentsForLead', () => {
  afterEach(() => jest.clearAllMocks());

  it('exits every active enrollment for the lead', async () => {
    (Enrollment.find as jest.Mock).mockReturnValue({
      lean: jest.fn().mockResolvedValue([
        { _id: { toString: () => 'enr-1' } },
        { _id: { toString: () => 'enr-2' } },
      ]),
    });
    const doc1 = { status: 'active', save: jest.fn().mockResolvedValue(undefined) };
    const doc2 = { status: 'active', save: jest.fn().mockResolvedValue(undefined) };
    (Enrollment.findById as jest.Mock).mockResolvedValueOnce(doc1).mockResolvedValueOnce(doc2);

    await exitAllActiveEnrollmentsForLead('lead-1', 'unsubscribe_request');

    expect(Enrollment.find).toHaveBeenCalledWith({ lead_id: 'lead-1', status: 'active' }, '_id');
    expect(doc1.status).toBe('exited');
    expect(doc2.status).toBe('exited');
    expect(doc1.save).toHaveBeenCalled();
    expect(doc2.save).toHaveBeenCalled();
  });

  it('is a no-op when the lead has no active enrollments', async () => {
    (Enrollment.find as jest.Mock).mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });

    await exitAllActiveEnrollmentsForLead('lead-1', 'unsubscribe_request');

    expect(Enrollment.findById).not.toHaveBeenCalled();
  });
});

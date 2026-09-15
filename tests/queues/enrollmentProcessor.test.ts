jest.mock('../../src/models/Enrollment.model', () => ({ Enrollment: { findById: jest.fn() } }));
jest.mock('../../src/models/EmailTemplateVersion.model', () => ({ EmailTemplateVersion: { findById: jest.fn() } }));
jest.mock('../../src/models/Lead.model', () => ({ Lead: { findById: jest.fn() } }));
jest.mock('../../src/models/Contact.model', () => ({ Contact: { findById: jest.fn() } }));
jest.mock('../../src/models/Organization.model', () => ({ Organization: { findById: jest.fn() } }));
jest.mock('../../src/models/LeadActivity.model', () => ({ LeadActivity: { create: jest.fn() } }));
jest.mock('../../src/services/domainRouter.service', () => ({ resolveSendingRoute: jest.fn() }));
jest.mock('../../src/services/linkTracking.service', () => ({ rewriteLinksForTracking: jest.fn() }));
jest.mock('../../src/services/sendGuardrail.service', () => ({ canSend: jest.fn(), recordSend: jest.fn() }));
jest.mock('../../src/queues/enrollmentQueue', () => ({
  enqueueStepJob: jest.fn(),
  enqueueGuardrailRetryJob: jest.fn(),
}));

import { Contact } from '../../src/models/Contact.model';
import { EmailTemplateVersion } from '../../src/models/EmailTemplateVersion.model';
import { Enrollment } from '../../src/models/Enrollment.model';
import { Lead } from '../../src/models/Lead.model';
import { LeadActivity } from '../../src/models/LeadActivity.model';
import { Organization } from '../../src/models/Organization.model';
import { enqueueGuardrailRetryJob, enqueueStepJob } from '../../src/queues/enrollmentQueue';
import { EnrollmentStepError, processEnrollmentStepJob } from '../../src/queues/enrollmentProcessor';
import { resolveSendingRoute } from '../../src/services/domainRouter.service';
import { rewriteLinksForTracking } from '../../src/services/linkTracking.service';
import { canSend, recordSend } from '../../src/services/sendGuardrail.service';

function lean(value: unknown) {
  return { lean: jest.fn().mockResolvedValue(value) };
}

function mockEnrollment(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: { toString: () => 'enr-1' },
    lead_id: { toString: () => 'lead-1' },
    current_step_index: 0,
    status: 'active',
    steps: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  (Enrollment.findById as jest.Mock).mockResolvedValue(doc);
  return doc;
}

describe('processEnrollmentStepJob', () => {
  afterEach(() => jest.clearAllMocks());

  it('no-ops when the enrollment does not exist', async () => {
    (Enrollment.findById as jest.Mock).mockResolvedValue(null);
    await processEnrollmentStepJob('missing');
    expect(enqueueStepJob).not.toHaveBeenCalled();
  });

  it('no-ops when the enrollment is not active (e.g. paused)', async () => {
    mockEnrollment({ status: 'paused', steps: [{ kind: 'wait', wait_amount: 1, wait_unit: 'days' }] });
    await processEnrollmentStepJob('enr-1');
    expect(enqueueStepJob).not.toHaveBeenCalled();
  });

  it('completes the enrollment when current_step_index has no step', async () => {
    const doc = mockEnrollment({ current_step_index: 2, steps: [{ kind: 'wait', wait_amount: 1, wait_unit: 'days' }] });
    await processEnrollmentStepJob('enr-1');
    expect(doc.status).toBe('completed');
    expect(doc.completed_at).toBeInstanceOf(Date);
    expect(doc.save).toHaveBeenCalled();
    expect(enqueueStepJob).not.toHaveBeenCalled();
  });

  it('processes a wait step with zero external effect, advancing with the computed delay', async () => {
    const doc = mockEnrollment({
      current_step_index: 0,
      steps: [
        { kind: 'wait', wait_amount: 2, wait_unit: 'hours' },
        { kind: 'call_task', call_task_instructions: 'follow up' },
      ],
    });

    await processEnrollmentStepJob('enr-1');

    expect(doc.current_step_index).toBe(1);
    expect(doc.save).toHaveBeenCalled();
    expect(enqueueStepJob).toHaveBeenCalledWith('enr-1', 1, 2 * 60 * 60 * 1000);
    expect(LeadActivity.create).not.toHaveBeenCalled();
  });

  it('marks the enrollment completed when a step is the last one', async () => {
    const doc = mockEnrollment({
      current_step_index: 0,
      steps: [{ kind: 'wait', wait_amount: 1, wait_unit: 'days' }],
    });

    await processEnrollmentStepJob('enr-1');

    expect(doc.status).toBe('completed');
    expect(doc.completed_at).toBeInstanceOf(Date);
    expect(enqueueStepJob).not.toHaveBeenCalled();
  });

  it('processes a call_task step by logging a task LeadActivity and advancing immediately', async () => {
    const doc = mockEnrollment({
      current_step_index: 0,
      steps: [
        { kind: 'call_task', call_task_instructions: 'Discovery call' },
        { kind: 'wait', wait_amount: 1, wait_unit: 'days' },
      ],
    });

    await processEnrollmentStepJob('enr-1');

    expect(LeadActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: doc.lead_id,
        kind: 'task',
        enrollment_id: doc._id,
        workflow_step_index: 0,
        subject: 'Discovery call',
      }),
    );
    expect(enqueueStepJob).toHaveBeenCalledWith('enr-1', 1, 0);
  });

  it('throws for an sms step without advancing or logging anything', async () => {
    mockEnrollment({
      current_step_index: 0,
      steps: [{ kind: 'sms', sms_body: 'hi' }, { kind: 'wait', wait_amount: 1, wait_unit: 'days' }],
    });

    await expect(processEnrollmentStepJob('enr-1')).rejects.toThrow('Zoom Phone SMS is blocked');
    expect(enqueueStepJob).not.toHaveBeenCalled();
    expect(LeadActivity.create).not.toHaveBeenCalled();
  });

  describe('email step', () => {
    function mockEmailPipeline() {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue(
        lean({ _id: { toString: () => 'ver-1' }, status: 'APPROVED', subject_line: 'Hi', body_html: '<p>hi <a href="https://x.com">link</a></p>' }),
      );
      (Lead.findById as jest.Mock).mockReturnValue(
        lean({ contact_id: 'contact-1', org_id: { toString: () => 'org-1' } }),
      );
      (Contact.findById as jest.Mock).mockReturnValue(lean({ email: 'lead@example.com' }));
      (Organization.findById as jest.Mock).mockReturnValue(lean({ _id: 'org-1', sending_domains: ['aeonsign.com'] }));
      (rewriteLinksForTracking as jest.Mock).mockResolvedValue('<p>hi <a href="https://track/r/tok">link</a></p>');
      const send = jest.fn().mockResolvedValue({
        providerMessageId: 'msg-1',
        providerThreadId: 'thread-1',
        sentAt: new Date('2026-01-01'),
      });
      (resolveSendingRoute as jest.Mock).mockReturnValue({
        provider: { send },
        mailbox: 'sales@aeonsign.com',
        domain: 'aeonsign.com',
      });
      (canSend as jest.Mock).mockResolvedValue({ allowed: true, action: 'allowed' });
      return { send };
    }

    it('sends via the resolved provider, rewrites links, logs a LeadActivity, and advances', async () => {
      const { send } = mockEmailPipeline();
      const doc = mockEnrollment({
        current_step_index: 0,
        steps: [
          { kind: 'email', email_template_version_id: 'ver-1', sending_domain: 'aeonsign.com' },
          { kind: 'wait', wait_amount: 1, wait_unit: 'days' },
        ],
      });

      await processEnrollmentStepJob('enr-1');

      expect(resolveSendingRoute).toHaveBeenCalledWith(
        expect.objectContaining({ sending_domains: ['aeonsign.com'] }),
        'aeonsign.com',
      );
      expect(canSend).toHaveBeenCalledWith('aeonsign.com', 'sales@aeonsign.com', 'org-1', {
        requiresWarmup: false,
      });
      expect(rewriteLinksForTracking).toHaveBeenCalledWith(
        '<p>hi <a href="https://x.com">link</a></p>',
        { orgId: 'org-1', leadId: 'lead-1', emailTemplateVersionId: 'ver-1' },
        expect.any(String),
      );
      expect(send).toHaveBeenCalledWith('sales@aeonsign.com', {
        to: ['lead@example.com'],
        subject: 'Hi',
        html: '<p>hi <a href="https://track/r/tok">link</a></p>',
      });
      expect(LeadActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lead_id: doc.lead_id,
          kind: 'email',
          direction: 'outbound',
          provider_message_id: 'msg-1',
          provider_thread_id: 'thread-1',
        }),
      );
      expect(recordSend).toHaveBeenCalledWith({
        domain: 'aeonsign.com',
        mailbox: 'sales@aeonsign.com',
        orgId: 'org-1',
        leadId: 'lead-1',
        enrollmentId: 'enr-1',
      });
      expect(enqueueStepJob).toHaveBeenCalledWith('enr-1', 1, 0);
    });

    it('passes the enrollment-frozen requires_warmup flag through to canSend', async () => {
      mockEmailPipeline();
      mockEnrollment({
        current_step_index: 0,
        requires_warmup: true,
        steps: [{ kind: 'email', email_template_version_id: 'ver-1', sending_domain: 'aeonsign.com' }],
      });

      await processEnrollmentStepJob('enr-1');

      expect(canSend).toHaveBeenCalledWith('aeonsign.com', 'sales@aeonsign.com', 'org-1', {
        requiresWarmup: true,
      });
    });

    it('defers the send when SendGuardrail denies it, without sending, advancing, or logging anything', async () => {
      const { send } = mockEmailPipeline();
      (canSend as jest.Mock).mockResolvedValue({
        allowed: false,
        action: 'throttled',
        reason: 'ramp cap reached',
      });
      const doc = mockEnrollment({
        current_step_index: 0,
        steps: [
          { kind: 'email', email_template_version_id: 'ver-1', sending_domain: 'aeonsign.com' },
          { kind: 'wait', wait_amount: 1, wait_unit: 'days' },
        ],
      });

      await processEnrollmentStepJob('enr-1');

      expect(send).not.toHaveBeenCalled();
      expect(LeadActivity.create).not.toHaveBeenCalled();
      expect(recordSend).not.toHaveBeenCalled();
      expect(doc.save).not.toHaveBeenCalled();
      expect(doc.current_step_index).toBe(0);
      expect(enqueueStepJob).not.toHaveBeenCalled();
      expect(enqueueGuardrailRetryJob).toHaveBeenCalledWith('enr-1', 0, expect.any(Number));
    });

    it('refuses to send a version that is not APPROVED', async () => {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue(lean({ status: 'DRAFT' }));
      mockEnrollment({
        current_step_index: 0,
        steps: [{ kind: 'email', email_template_version_id: 'ver-1', sending_domain: 'aeonsign.com' }],
      });

      await expect(processEnrollmentStepJob('enr-1')).rejects.toThrow(EnrollmentStepError);
      await expect(processEnrollmentStepJob('enr-1')).rejects.toThrow('not APPROVED');
    });

    it('fails clearly when the contact has no email address', async () => {
      (EmailTemplateVersion.findById as jest.Mock).mockReturnValue(lean({ status: 'APPROVED', subject_line: 'x', body_html: '<p/>' }));
      (Lead.findById as jest.Mock).mockReturnValue(lean({ contact_id: 'contact-1', org_id: { toString: () => 'org-1' } }));
      (Contact.findById as jest.Mock).mockReturnValue(lean({ email: undefined }));
      mockEnrollment({
        current_step_index: 0,
        steps: [{ kind: 'email', email_template_version_id: 'ver-1', sending_domain: 'aeonsign.com' }],
      });

      await expect(processEnrollmentStepJob('enr-1')).rejects.toThrow('no email address');
    });
  });
});

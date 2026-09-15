import { Types } from 'mongoose';
import { WorkflowTemplate } from '../../src/models/WorkflowTemplate.model';

describe('WorkflowTemplate model', () => {
  it('requires org_id and name', () => {
    const doc = new WorkflowTemplate({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.name).toBeDefined();
  });

  it('defaults requires_warmup to false and steps to empty', () => {
    const doc = new WorkflowTemplate({ org_id: new Types.ObjectId(), name: 'Cold open sequence' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.requires_warmup).toBe(false);
    expect(doc.steps).toEqual([]);
  });

  it('rejects an email step missing email_template_version_id or sending_domain', () => {
    const doc = new WorkflowTemplate({
      org_id: new Types.ObjectId(),
      name: 'x',
      steps: [{ kind: 'email' }],
    });
    const err = doc.validateSync();
    expect(err?.errors['steps.0.email_template_version_id']).toBeDefined();
    expect(err?.errors['steps.0.sending_domain']).toBeDefined();
  });

  it('rejects a wait step missing wait_amount or wait_unit', () => {
    const doc = new WorkflowTemplate({
      org_id: new Types.ObjectId(),
      name: 'x',
      steps: [{ kind: 'wait' }],
    });
    const err = doc.validateSync();
    expect(err?.errors['steps.0.wait_amount']).toBeDefined();
    expect(err?.errors['steps.0.wait_unit']).toBeDefined();
  });

  it('rejects an sms step missing sms_body and a call_task step missing call_task_instructions', () => {
    const doc = new WorkflowTemplate({
      org_id: new Types.ObjectId(),
      name: 'x',
      steps: [{ kind: 'sms' }, { kind: 'call_task' }],
    });
    const err = doc.validateSync();
    expect(err?.errors['steps.0.sms_body']).toBeDefined();
    expect(err?.errors['steps.1.call_task_instructions']).toBeDefined();
  });

  it('accepts a full realistic sequence: email, wait, call_task, email', () => {
    const doc = new WorkflowTemplate({
      org_id: new Types.ObjectId(),
      name: 'Aeon Sign FedEx ISP cadence',
      requires_warmup: true,
      steps: [
        { kind: 'email', email_template_version_id: new Types.ObjectId(), sending_domain: 'aeonsign.com' },
        { kind: 'wait', wait_amount: 3, wait_unit: 'days' },
        { kind: 'call_task', call_task_instructions: 'Discovery call, ask about current DSP docs process' },
        { kind: 'email', email_template_version_id: new Types.ObjectId(), sending_domain: 'aeonsign.com' },
      ],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.steps).toHaveLength(4);
  });
});

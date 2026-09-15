import { Types } from 'mongoose';
import { Enrollment } from '../../src/models/Enrollment.model';

function validStep() {
  return { kind: 'wait' as const, wait_amount: 1, wait_unit: 'days' as const };
}

describe('Enrollment model', () => {
  it('requires lead_id and workflow_template_id', () => {
    const doc = new Enrollment({});
    const err = doc.validateSync();
    expect(err?.errors.lead_id).toBeDefined();
    expect(err?.errors.workflow_template_id).toBeDefined();
  });

  it('defaults current_step_index to 0 and status to active', () => {
    const doc = new Enrollment({
      lead_id: new Types.ObjectId(),
      workflow_template_id: new Types.ObjectId(),
      steps: [validStep()],
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.current_step_index).toBe(0);
    expect(doc.status).toBe('active');
    expect(doc.started_at).toBeInstanceOf(Date);
    expect(doc.completed_at).toBeNull();
  });

  it('defaults requires_warmup to false', () => {
    const doc = new Enrollment({
      lead_id: new Types.ObjectId(),
      workflow_template_id: new Types.ObjectId(),
      steps: [validStep()],
    });
    expect(doc.requires_warmup).toBe(false);
  });

  it('snapshots requires_warmup: true when set', () => {
    const doc = new Enrollment({
      lead_id: new Types.ObjectId(),
      workflow_template_id: new Types.ObjectId(),
      steps: [validStep()],
      requires_warmup: true,
    });
    expect(doc.requires_warmup).toBe(true);
  });

  it('defaults workflow_type to null and send_time_strategy to manual', () => {
    const doc = new Enrollment({
      lead_id: new Types.ObjectId(),
      workflow_template_id: new Types.ObjectId(),
      steps: [validStep()],
    });
    expect(doc.workflow_type).toBeNull();
    expect(doc.send_time_strategy).toBe('manual');
  });

  it('snapshots an explicit workflow_type and send_time_strategy', () => {
    const doc = new Enrollment({
      lead_id: new Types.ObjectId(),
      workflow_template_id: new Types.ObjectId(),
      steps: [validStep()],
      workflow_type: 'cold_outreach',
      send_time_strategy: 'ai_automatic',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.workflow_type).toBe('cold_outreach');
    expect(doc.send_time_strategy).toBe('ai_automatic');
  });

  it('rejects an unknown status', () => {
    const doc = new Enrollment({
      lead_id: new Types.ObjectId(),
      workflow_template_id: new Types.ObjectId(),
      steps: [validStep()],
      status: 'archived',
    });
    expect(doc.validateSync()?.errors.status).toBeDefined();
  });

  it('enforces at most one active enrollment per (lead, template) via a partial unique index', () => {
    const indexes = Enrollment.schema.indexes();
    const compound = indexes.find(
      ([fields]) => fields.lead_id === 1 && fields.workflow_template_id === 1,
    );
    expect(compound).toBeDefined();
    expect(compound?.[1].unique).toBe(true);
    expect(compound?.[1].partialFilterExpression).toEqual({ status: 'active' });
  });

  it('still validates each snapshotted step the same way a WorkflowTemplate step would', () => {
    const doc = new Enrollment({
      lead_id: new Types.ObjectId(),
      workflow_template_id: new Types.ObjectId(),
      steps: [{ kind: 'email' }],
    });
    expect(doc.validateSync()?.errors['steps.0.email_template_version_id']).toBeDefined();
  });
});

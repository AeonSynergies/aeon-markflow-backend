import { Types } from 'mongoose';
import { EmailTemplate } from '../../src/models/EmailTemplate.model';

describe('EmailTemplate model', () => {
  it('requires org_id and name', () => {
    const doc = new EmailTemplate({});
    const err = doc.validateSync();
    expect(err?.errors.org_id).toBeDefined();
    expect(err?.errors.name).toBeDefined();
  });

  it('defaults ab_group_id and current_version_id to null', () => {
    const doc = new EmailTemplate({ org_id: new Types.ObjectId(), name: 'FedEx ISP cold open' });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.ab_group_id).toBeNull();
    expect(doc.current_version_id).toBeNull();
  });

  it('accepts persona and workflow_position labels', () => {
    const doc = new EmailTemplate({
      org_id: new Types.ObjectId(),
      name: 'FedEx ISP cold open',
      persona: 'fedex_isp',
      workflow_position: 'cold_open',
    });
    expect(doc.validateSync()).toBeUndefined();
  });

  it('accepts an intended_workflow_type label', () => {
    const doc = new EmailTemplate({
      org_id: new Types.ObjectId(),
      name: 'FedEx ISP cold open',
      intended_workflow_type: 'cold_outreach',
    });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.intended_workflow_type).toBe('cold_outreach');
  });
});

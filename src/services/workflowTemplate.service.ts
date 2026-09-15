import { WorkflowTemplate, type WorkflowTemplateDocument } from '../models/WorkflowTemplate.model';
import type { WorkflowStepInput } from '../types/api/workflow';

export class WorkflowTemplateNotFoundError extends Error {
  constructor(id: string) {
    super(`WorkflowTemplate ${id} not found`);
    this.name = 'WorkflowTemplateNotFoundError';
  }
}

export interface WorkflowTemplateInput {
  name: string;
  requires_warmup?: boolean;
  steps: WorkflowStepInput[];
}

export async function createWorkflowTemplate(
  orgId: string,
  input: WorkflowTemplateInput,
): Promise<WorkflowTemplateDocument> {
  return WorkflowTemplate.create({
    org_id: orgId,
    name: input.name,
    requires_warmup: input.requires_warmup ?? false,
    steps: input.steps,
  });
}

/**
 * Edits a template's own definition. This never touches any Enrollment already running
 * against it — Enrollment.steps is a separate, frozen snapshot taken at enrollment time — so
 * a template can be safely iterated on without disturbing leads mid-sequence.
 */
export async function updateWorkflowTemplate(
  templateId: string,
  updates: Partial<WorkflowTemplateInput>,
): Promise<WorkflowTemplateDocument> {
  const template = await WorkflowTemplate.findById(templateId);
  if (!template) throw new WorkflowTemplateNotFoundError(templateId);

  if (updates.name !== undefined) template.name = updates.name;
  if (updates.requires_warmup !== undefined) template.requires_warmup = updates.requires_warmup;
  if (updates.steps !== undefined) template.set('steps', updates.steps);

  await template.save();
  return template;
}

export async function getWorkflowTemplate(templateId: string): Promise<WorkflowTemplateDocument> {
  const template = await WorkflowTemplate.findById(templateId);
  if (!template) throw new WorkflowTemplateNotFoundError(templateId);
  return template;
}

export async function listWorkflowTemplatesForOrg(orgId: string): Promise<WorkflowTemplateDocument[]> {
  return WorkflowTemplate.find({ org_id: orgId }).sort({ createdAt: -1 });
}

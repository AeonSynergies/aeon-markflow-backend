import { Enrollment } from '../models/Enrollment.model';
import { SavedList } from '../models/SavedList.model';
import { enqueueStepJob } from '../queues/enrollmentQueue';
import type { WorkflowStepInput } from '../types/api/workflow';
import { resolveStepForEnrollment } from './abTesting.service';
import { getWorkflowTemplate } from './workflowTemplate.service';

export class SavedListNotFoundError extends Error {
  constructor(id: string) {
    super(`SavedList ${id} not found`);
    this.name = 'SavedListNotFoundError';
  }
}

export class EmptyWorkflowTemplateError extends Error {
  constructor(templateId: string) {
    super(`WorkflowTemplate ${templateId} has no steps to enroll into`);
    this.name = 'EmptyWorkflowTemplateError';
  }
}

export class CrossOrgReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrossOrgReferenceError';
  }
}

export interface EnrollSavedListResult {
  enrolledCount: number;
  skippedCount: number;
  enrollmentIds: string[];
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

/**
 * Enrolls every lead in a SavedList into a WorkflowTemplate: one Enrollment per lead, each with
 * its own frozen snapshot of the template's current steps, and the first step's job enqueued
 * immediately. A lead already actively enrolled in this same template is skipped rather than
 * erroring the whole batch (enforced by Enrollment's partial unique index).
 */
export async function enrollSavedList(templateId: string, savedListId: string): Promise<EnrollSavedListResult> {
  const template = await getWorkflowTemplate(templateId);
  if (template.steps.length === 0) throw new EmptyWorkflowTemplateError(templateId);

  const savedList = await SavedList.findById(savedListId).lean();
  if (!savedList) throw new SavedListNotFoundError(savedListId);

  if (savedList.org_id.toString() !== template.org_id.toString()) {
    throw new CrossOrgReferenceError(
      `SavedList ${savedListId} belongs to a different org than WorkflowTemplate ${templateId}`,
    );
  }

  const enrollmentIds: string[] = [];
  let skippedCount = 0;

  for (const leadId of savedList.lead_ids) {
    try {
      // Resolved independently per lead: an A/B group's traffic split is a per-enrollment coin
      // flip, not a batch-wide choice (see abTesting.service.ts's own doc comment). Converted to
      // plain objects first — resolveStepForEnrollment takes the API-shaped WorkflowStepInput,
      // not a live Mongoose subdocument.
      const plainSteps = JSON.parse(JSON.stringify(template.steps)) as WorkflowStepInput[];
      const steps = await Promise.all(plainSteps.map(resolveStepForEnrollment));

      const enrollment = await Enrollment.create({
        lead_id: leadId,
        workflow_template_id: template._id,
        steps,
        requires_warmup: template.requires_warmup ?? false,
        current_step_index: 0,
        status: 'active',
      });
      enrollmentIds.push(enrollment._id.toString());
      await enqueueStepJob(enrollment._id.toString(), 0, 0);
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        skippedCount += 1;
        continue;
      }
      throw error;
    }
  }

  return { enrolledCount: enrollmentIds.length, skippedCount, enrollmentIds };
}

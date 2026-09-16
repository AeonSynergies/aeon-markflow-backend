import type { EmailTemplateVersionStatus } from '../constants/emailTemplate';
import { EmailTemplate, type EmailTemplateDocument } from '../models/EmailTemplate.model';
import { EmailTemplateVersion } from '../models/EmailTemplateVersion.model';
import { WorkflowTemplate } from '../models/WorkflowTemplate.model';
import { EmailTemplateNotFoundError } from './emailTemplateVersion.service';

export interface ListEmailTemplatesFilters {
  persona?: string;
  workflowPosition?: string;
  intendedWorkflowType?: string;
  /** At least one of the template's versions must have this status. */
  status?: EmailTemplateVersionStatus;
}

/**
 * Lists an org's email templates, optionally narrowed by the same audience/cadence-position
 * metadata used across the Winning Email Library seed (persona, workflow_position,
 * intended_workflow_type) and by whether at least one version has a given status. This is also
 * the workflow builder's own template-picker query: called with status: 'APPROVED' plus whichever
 * context filters a step inspector knows (persona, position, workflow_type), it narrows
 * candidates directly to templates that already have an approved, pinnable version
 * (current_version_id) — never every approved template in the org.
 */
export async function listEmailTemplatesForOrg(
  orgId: string,
  filters: ListEmailTemplatesFilters = {},
): Promise<EmailTemplateDocument[]> {
  const query: Record<string, unknown> = { org_id: orgId };
  if (filters.persona) query.persona = filters.persona;
  if (filters.workflowPosition) query.workflow_position = filters.workflowPosition;
  if (filters.intendedWorkflowType) query.intended_workflow_type = filters.intendedWorkflowType;

  if (filters.status) {
    // current_version_id only ever reflects the most recently *approved* version (see
    // approveVersion in emailTemplateVersion.service.ts) — it can't answer "has a DRAFT/
    // PENDING_APPROVAL/REJECTED version" at all, so status filtering always goes through
    // EmailTemplateVersion directly rather than relying on it.
    const templateIdsWithStatus = await EmailTemplateVersion.find({ status: filters.status }).distinct(
      'email_template_id',
    );
    query._id = { $in: templateIdsWithStatus };
  }

  return EmailTemplate.find(query).sort({ name: 1 });
}

export async function getEmailTemplate(templateId: string): Promise<EmailTemplateDocument> {
  const template = await EmailTemplate.findById(templateId);
  if (!template) throw new EmailTemplateNotFoundError(templateId);
  return template;
}

export interface EmailTemplateUsage {
  workflowTemplateId: string;
  workflowTemplateName: string;
  workflowType: string | null;
  stepIndex: number;
  emailTemplateVersionId: string;
  versionNumber: number;
}

/**
 * Every WorkflowTemplate step currently pinned to any version of this EmailTemplate — computed
 * live from WorkflowTemplate.steps on every call, no separate stored index to keep in sync.
 * Deliberately never looks at Enrollment.steps: those are frozen per-enrollment snapshots (see
 * Enrollment.model.ts's own doc comment) that never change once a lead is enrolled, so they can
 * never be a "current" usage — only a WorkflowTemplate's own live steps can still be edited (or
 * broken) by changing or removing this template, which is exactly what this endpoint exists to
 * warn a human about before they do that.
 */
export async function listEmailTemplateUsages(templateId: string): Promise<EmailTemplateUsage[]> {
  const template = await getEmailTemplate(templateId);

  const versions = await EmailTemplateVersion.find({ email_template_id: templateId })
    .select('_id version_number')
    .lean();
  if (versions.length === 0) return [];

  const versionNumberById = new Map(versions.map((version) => [version._id.toString(), version.version_number]));
  const versionIds = versions.map((version) => version._id);

  const workflowTemplates = await WorkflowTemplate.find({
    org_id: template.org_id,
    'steps.email_template_version_id': { $in: versionIds },
  })
    .select('name workflow_type steps')
    .lean();

  const usages: EmailTemplateUsage[] = [];
  for (const workflowTemplate of workflowTemplates) {
    workflowTemplate.steps.forEach((step, stepIndex) => {
      const versionId = step.email_template_version_id?.toString();
      const versionNumber = versionId ? versionNumberById.get(versionId) : undefined;
      if (versionId === undefined || versionNumber === undefined) return;

      usages.push({
        workflowTemplateId: workflowTemplate._id.toString(),
        workflowTemplateName: workflowTemplate.name,
        workflowType: workflowTemplate.workflow_type ?? null,
        stepIndex,
        emailTemplateVersionId: versionId,
        versionNumber,
      });
    });
  }
  return usages;
}

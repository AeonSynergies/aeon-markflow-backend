import { Types } from 'mongoose';
import type { Role } from '../constants/access';
import { AB_TEST_MIN_SAMPLE_SIZE_PER_VARIANT } from '../constants/emailAnalytics';
import { TEMPLATE_APPROVER_ROLES } from '../constants/emailTemplate';
import { EmailTemplate, type EmailTemplateDocument } from '../models/EmailTemplate.model';
import { EmailTemplateVersion } from '../models/EmailTemplateVersion.model';
import type { WorkflowStepInput } from '../types/api/workflow';
import { computeVersionMetrics, type VersionMetrics } from './emailPerformanceAnalysis.service';
import { EmailTemplateNotFoundError, UnauthorizedApproverRoleError } from './emailTemplateVersion.service';

export class InsufficientAbTestSampleError extends Error {
  constructor(abGroupId: string) {
    super(`A/B group ${abGroupId} doesn't have enough sample size in every variant to promote a winner yet`);
    this.name = 'InsufficientAbTestSampleError';
  }
}

/**
 * Assigns the group's own ab_group_id if this template doesn't have one yet — the incumbent
 * joins its own group the moment a first variant is proposed against it, rather than needing
 * one set up in advance.
 */
export async function ensureAbGroupId(templateId: string): Promise<string> {
  const template = await EmailTemplate.findById(templateId);
  if (!template) throw new EmailTemplateNotFoundError(templateId);
  if (template.ab_group_id) return template.ab_group_id.toString();

  template.ab_group_id = new Types.ObjectId();
  await template.save();
  return template.ab_group_id.toString();
}

/**
 * Creates a new EmailTemplate to hold a challenger variant, sharing the incumbent's ab_group_id
 * (creating one if needed). Its current_version_id starts null — see resolveStepForEnrollment,
 * which only ever splits traffic across variants that already have an APPROVED current version,
 * so a freshly-suggested variant never enters live rotation until a human approves it.
 */
export async function createVariantTemplate(
  incumbentTemplateId: string,
  variantName?: string,
): Promise<EmailTemplateDocument> {
  const incumbent = await EmailTemplate.findById(incumbentTemplateId).lean();
  if (!incumbent) throw new EmailTemplateNotFoundError(incumbentTemplateId);

  const abGroupId = await ensureAbGroupId(incumbentTemplateId);

  return EmailTemplate.create({
    org_id: incumbent.org_id,
    name: variantName ?? `${incumbent.name} (variant)`,
    persona: incumbent.persona,
    workflow_position: incumbent.workflow_position,
    ab_group_id: abGroupId,
    current_version_id: null,
  });
}

/**
 * Resolves a WorkflowStep's pinned email_template_version_id at enrollment-snapshot time — the
 * one point where an A/B group's traffic actually gets split. If the step's authored version
 * belongs to a template with an ab_group_id, and that group currently has 2+ variants with a
 * live (APPROVED) version, picks one uniformly at random for this particular enrollment instead
 * of always using the step's literally-authored version. A group with only one live variant
 * (the common case — no test running) is a no-op: every enrollment gets exactly what the step
 * was authored with, same as before A/B testing existed.
 *
 * This keeps the "never latest" rule intact: once resolved, the choice is frozen into the
 * enrollment's own steps snapshot (see enrollment.service.ts) exactly like every other step
 * field — a lead's in-flight sequence never changes because a test's traffic split changed.
 */
export async function resolveStepForEnrollment(step: WorkflowStepInput): Promise<WorkflowStepInput> {
  if (step.kind !== 'email' || !step.email_template_version_id) return step;

  const version = await EmailTemplateVersion.findById(step.email_template_version_id).lean();
  if (!version) return step;

  const template = await EmailTemplate.findById(version.email_template_id).lean();
  if (!template?.ab_group_id) return step;

  const variants = await EmailTemplate.find({
    ab_group_id: template.ab_group_id,
    current_version_id: { $ne: null },
  })
    .select('current_version_id')
    .lean();

  if (variants.length <= 1) return step;

  const chosen = variants[Math.floor(Math.random() * variants.length)];
  return { ...step, email_template_version_id: chosen.current_version_id!.toString() };
}

export interface AbGroupVariantResult {
  templateId: string;
  templateName: string;
  versionId?: string;
  metrics?: VersionMetrics;
}

export interface AbGroupResults {
  abGroupId: string;
  variants: AbGroupVariantResult[];
  /** True once every variant with a live version has cleared AB_TEST_MIN_SAMPLE_SIZE_PER_VARIANT. */
  readyToDecide: boolean;
}

/** Head-to-head results for every template in an ab_group, for deciding whether/which to promote. */
export async function getAbGroupResults(abGroupId: string): Promise<AbGroupResults> {
  const templates = await EmailTemplate.find({ ab_group_id: abGroupId }).lean();

  const variants: AbGroupVariantResult[] = await Promise.all(
    templates.map(async (template) => {
      if (!template.current_version_id) {
        return { templateId: template._id.toString(), templateName: template.name };
      }
      const metrics = await computeVersionMetrics(template.current_version_id.toString());
      return {
        templateId: template._id.toString(),
        templateName: template.name,
        versionId: template.current_version_id.toString(),
        metrics,
      };
    }),
  );

  const liveVariants = variants.filter((variant) => variant.metrics);
  const readyToDecide =
    liveVariants.length >= 2 &&
    liveVariants.every((variant) => (variant.metrics?.sentCount ?? 0) >= AB_TEST_MIN_SAMPLE_SIZE_PER_VARIANT);

  return { abGroupId, variants, readyToDecide };
}

/**
 * Promotes a winner: every other template in the group loses its ab_group_id, so
 * resolveStepForEnrollment's live-variant query only ever finds the winner going forward — no
 * "retired" status needed on the losing versions themselves, they just stop being selected.
 * Requires a template-approver role (same bar as approving an EmailTemplateVersion) and throws
 * if the defined sample hasn't been reached yet in every variant — promoting off an
 * under-sampled test is exactly the kind of premature call this gate exists to prevent. Never
 * called automatically; per CLAUDE.md's human-in-the-loop rule, which variant wins is a
 * strategy decision, not a safety mechanism.
 */
export async function promoteWinner(abGroupId: string, winningTemplateId: string, role: Role): Promise<void> {
  if (!TEMPLATE_APPROVER_ROLES.includes(role)) {
    throw new UnauthorizedApproverRoleError(role);
  }

  const results = await getAbGroupResults(abGroupId);
  if (!results.readyToDecide) {
    throw new InsufficientAbTestSampleError(abGroupId);
  }

  await EmailTemplate.updateMany(
    { ab_group_id: abGroupId, _id: { $ne: winningTemplateId } },
    { ab_group_id: null },
  );
}

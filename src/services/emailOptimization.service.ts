import { EmailTemplate } from '../models/EmailTemplate.model';
import { EmailTemplateVersion, type EmailTemplateVersionDocument } from '../models/EmailTemplateVersion.model';
import { ReviewTask, type ReviewTaskDocument } from '../models/ReviewTask.model';
import { createVariantTemplate } from './abTesting.service';
import { generateEmailDraft } from './emailGeneration.service';
import { diagnoseVersion, type SymptomDiagnosis } from './emailPerformanceAnalysis.service';

/** A variant is already in flight for this template's ab_group if one exists with no APPROVED
 * version yet — don't pile up a second suggestion on top of an unresolved one. */
async function hasOutstandingSuggestion(templateId: string): Promise<boolean> {
  const template = await EmailTemplate.findById(templateId).lean();
  if (!template?.ab_group_id) return false;

  const pendingVariant = await EmailTemplate.findOne({
    ab_group_id: template.ab_group_id,
    current_version_id: null,
  }).lean();
  return Boolean(pendingVariant);
}

async function hasOpenDeliverabilityFlag(versionId: string): Promise<boolean> {
  const existing = await ReviewTask.findOne({
    kind: 'email_version_deliverability',
    email_template_version_id: versionId,
    status: 'OPEN',
  }).lean();
  return Boolean(existing);
}

/**
 * Turns a content-fixable diagnosis (never 'high_bounce_rate' — see flagVersionDeliverabilityIssue
 * for that one) into a new DRAFT EmailTemplateVersion, under a brand-new variant EmailTemplate
 * sharing the incumbent's ab_group_id. Per CLAUDE.md's human-in-the-loop rule this is never
 * auto-applied — it sits in DRAFT until a human calls submitForReview/approveVersion, the same
 * gate as any other AI-drafted content. Returns null (does nothing) if a suggestion is already
 * outstanding for this template.
 */
export async function createAiSuggestionFromDiagnosis(
  templateId: string,
  currentVersion: { subjectLine: string; bodyHtml: string },
  diagnosis: SymptomDiagnosis,
): Promise<EmailTemplateVersionDocument | null> {
  if (diagnosis.symptom === 'high_bounce_rate') {
    throw new Error(
      'high_bounce_rate diagnoses never produce a content suggestion — call flagVersionDeliverabilityIssue instead',
    );
  }
  if (await hasOutstandingSuggestion(templateId)) return null;

  const variantTemplate = await createVariantTemplate(templateId);

  const draft = await generateEmailDraft({
    // Grounded in the INCUMBENT's org/persona/brand-voice/reference examples — the new variant
    // template has none of its own yet.
    emailTemplateId: templateId,
    request: {
      type: 'diagnosis_revision',
      symptom: diagnosis.symptom,
      diagnosisReason: diagnosis.reason,
      currentSubjectLine: currentVersion.subjectLine,
      currentBodyHtml: currentVersion.bodyHtml,
    },
  });

  return EmailTemplateVersion.create({
    email_template_id: variantTemplate._id,
    version_number: 1,
    subject_line: draft.subjectLine,
    body_html: draft.bodyHtml,
    generation_source: 'ai',
    status: 'DRAFT',
    ai_draft_snapshot: { subject_line: draft.subjectLine, body_html: draft.bodyHtml },
    ai_generation_metadata: {
      reference_templates: draft.referenceTemplates
        .map((example) => example.emailTemplateVersionId)
        .filter((id): id is string => Boolean(id)),
      reason: `[${diagnosis.symptom}] ${diagnosis.reason} — ${draft.reason}`,
      brand_voice_guidelines_version: draft.brandVoiceGuidelinesVersion,
      model: draft.model,
      generated_at: new Date(),
    },
  });
}

/**
 * The 'high_bounce_rate' branch: never a content rewrite, always a ReviewTask so a human
 * investigates the version itself (a bad list segment, a broken merge field, etc.) — separate
 * from whatever SendGuardrail is already doing about the domain overall. Idempotent: does
 * nothing while a flag for this exact version is still OPEN.
 */
export async function flagVersionDeliverabilityIssue(
  versionId: string,
  orgId: string,
  diagnosis: SymptomDiagnosis,
): Promise<ReviewTaskDocument | null> {
  if (await hasOpenDeliverabilityFlag(versionId)) return null;

  return ReviewTask.create({
    org_id: orgId,
    kind: 'email_version_deliverability',
    email_template_version_id: versionId,
    status: 'OPEN',
    rejection_reason: diagnosis.reason,
  });
}

export interface AnalysisRunSummary {
  scanned: number;
  diagnosed: number;
  suggestionsCreated: number;
  deliverabilityFlagsCreated: number;
  /** Insufficient sample size, or nothing currently looks off — diagnoseVersion doesn't
   * distinguish the two, and neither needs a different action here. */
  skipped: number;
}

/**
 * Scans every org's live (APPROVED, currently in use) EmailTemplateVersions, diagnoses each,
 * and acts on whatever it finds. Scheduled via emailAnalyticsQueue.ts — this is the whole
 * point of building the diagnosis logic: it runs on its own, not just on demand.
 */
export async function runEmailPerformanceAnalysis(): Promise<AnalysisRunSummary> {
  const templates = await EmailTemplate.find({ current_version_id: { $ne: null } }).lean();
  const summary: AnalysisRunSummary = {
    scanned: 0,
    diagnosed: 0,
    suggestionsCreated: 0,
    deliverabilityFlagsCreated: 0,
    skipped: 0,
  };

  for (const template of templates) {
    summary.scanned += 1;
    const versionId = template.current_version_id!.toString();

    const diagnosis = await diagnoseVersion(versionId);
    if (!diagnosis) {
      summary.skipped += 1;
      continue;
    }
    summary.diagnosed += 1;

    if (diagnosis.symptom === 'high_bounce_rate') {
      const flag = await flagVersionDeliverabilityIssue(versionId, template.org_id.toString(), diagnosis);
      if (flag) summary.deliverabilityFlagsCreated += 1;
      continue;
    }

    const version = await EmailTemplateVersion.findById(versionId).lean();
    if (!version) continue;

    const suggestion = await createAiSuggestionFromDiagnosis(
      template._id.toString(),
      { subjectLine: version.subject_line, bodyHtml: version.body_html },
      diagnosis,
    );
    if (suggestion) summary.suggestionsCreated += 1;
  }

  return summary;
}

export const REVIEW_TASK_STATUSES = ['OPEN', 'APPROVED', 'REJECTED'] as const;
export type ReviewTaskStatus = (typeof REVIEW_TASK_STATUSES)[number];

// email_template_version: an EmailTemplateVersion awaiting human approval (Phase 3).
// domain_guardrail: SendGuardrail paused a sending domain and needs a human to review why
// before resuming it (Phase 5) — see src/services/sendGuardrail.service.ts.
// email_version_deliverability: the diagnosis-by-symptom pipeline (Phase 6) found one specific
// template version's own bounce rate elevated — worth a human's attention even when the
// domain's own aggregate hasn't crossed SendGuardrail's own hard-stop threshold. Never paired
// with a content-rewrite suggestion — see emailPerformanceAnalysis.service.ts.
export const REVIEW_TASK_KINDS = [
  'email_template_version',
  'domain_guardrail',
  'email_version_deliverability',
] as const;
export type ReviewTaskKind = (typeof REVIEW_TASK_KINDS)[number];

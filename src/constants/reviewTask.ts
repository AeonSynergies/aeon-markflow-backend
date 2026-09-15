export const REVIEW_TASK_STATUSES = ['OPEN', 'APPROVED', 'REJECTED'] as const;
export type ReviewTaskStatus = (typeof REVIEW_TASK_STATUSES)[number];

// email_template_version: an EmailTemplateVersion awaiting human approval (Phase 3).
// domain_guardrail: SendGuardrail paused a sending domain and needs a human to review why
// before resuming it (Phase 5) — see src/services/sendGuardrail.service.ts.
// email_version_deliverability: the diagnosis-by-symptom pipeline (Phase 6) found one specific
// template version's own bounce rate elevated — worth a human's attention even when the
// domain's own aggregate hasn't crossed SendGuardrail's own hard-stop threshold. Never paired
// with a content-rewrite suggestion — see emailPerformanceAnalysis.service.ts.
// send_time_recommendation: send-time optimization (Phase 7) found a better-performing
// (day/hour/timezone, content) combination for one (org, workflow_type, persona) group under the
// org's ai_suggested strategy — see sendTimeOptimization.service.ts. Never created under
// ai_automatic, which applies a validated recommendation directly, with no ReviewTask.
export const REVIEW_TASK_KINDS = [
  'email_template_version',
  'domain_guardrail',
  'email_version_deliverability',
  'send_time_recommendation',
] as const;
export type ReviewTaskKind = (typeof REVIEW_TASK_KINDS)[number];

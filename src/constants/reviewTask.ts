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
// lead_unsubscribe_request: an inbound reply was AI-classified as an unsubscribe request —
// see replyIntentClassifier.service.ts / mailboxPoller.service.ts. Unlike every other kind, the
// action this task documents (Contact.global_do_not_contact set, every active enrollment for the
// lead exited) has already happened autonomously by the time this task opens — same
// human-in-the-loop exception as domain_guardrail: a compliance/safety action, not a
// content/strategy judgment call, so it's a record for a human to review, not a pending approval
// gate.
export const REVIEW_TASK_KINDS = [
  'email_template_version',
  'domain_guardrail',
  'email_version_deliverability',
  'send_time_recommendation',
  'lead_unsubscribe_request',
] as const;
export type ReviewTaskKind = (typeof REVIEW_TASK_KINDS)[number];

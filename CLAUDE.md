# Aeon MarkFlow — Build Brief for Claude Code

Working context for building **Aeon MarkFlow**, Aeon Synergies' sales & marketing engagement platform. Companion to **Aeon Onboard** (`AeonSynergies/aeon-onboard`, `AeonSynergies/aeon-onboard-backend`) — currently being cloned and migrated from Vercel (internal-testing only, no live data) to the same new AWS account MarkFlow will live in, with schema additions layered on top rather than a rewrite.

Full reasoning for every decision below lives in the project's 27-section requirements doc — ask for it if something here needs more depth.

## What this app is

MarkFlow owns everything **before** a deal is priced: Leads, the marketing/engagement workflow engine (email/call/SMS sequences), and Discovery call management. The moment a Discovery Meeting is scheduled and marked "Interested," a Deal hands off to Aeon Onboard, which owns pricing, contracts, payment, and client management from there. MarkFlow never touches pricing, contracts, or billing.

## Repos, backend separation, and shared auth

- `aeon-markflow` (frontend) / `aeon-markflow-backend` (backend) — separate repos, deliberately, so future hires can get frontend-only or backend-only access cleanly (GitHub has no folder-level access control within one repo).
- **MarkFlow and Onboard are two separate backend services, not a shared backend** — isolates MarkFlow's inherent volatility (new third-party integrations, active iteration) from Onboard's stability once it's handling real payments/contracts, and preserves the same future-access-separation logic as the repo split.
- **Shared identity without a shared backend**: both services validate JWTs signed with the same secret (or share one `Users`/`UserAccessGrant` collection in the same MongoDB cluster). One login, no live inter-service call needed for auth.
- **The only network calls between the two services**: the Handoff event (MarkFlow → Onboard, routine) and the Lost+Recycle event (Onboard → MarkFlow, rare) — both deliberate business-logic boundaries, not incidental coupling.
- Mitigate frontend/backend contract drift with a shared types package or checked-in OpenAPI spec once more than one person is working across that boundary.

## Stack

- Frontend: React 19 + TypeScript + Vite + Tailwind v4 + shadcn/Radix + TanStack Query (matches Onboard)
- Backend: Node.js + Express 5 + TypeScript + Mongoose/MongoDB + JWT/bcrypt + Swagger (matches Onboard)
- New for MarkFlow: `@xyflow/react` (workflow builder canvas), BullMQ + Redis (job queue), `@anthropic-ai/sdk` (AI generation), Microsoft Graph client + `googleapis` + axios-based Zoho wrapper (email adapters)
- Hosting (when ready to deploy, not needed for local dev): new AWS account (shared with Onboard) — App Runner (backend), S3 + CloudFront (frontend), MongoDB Atlas, ElastiCache/Upstash (Redis), Secrets Manager

## Core entities (Mongoose-shaped)

```
Contact        — shared across orgs: email, phone, firmographics (dsp_code, drivers, vans, stations),
                 global_do_not_contact (hard suppress override)
Lead           — one per (Contact, Organization): status enum (NEW-COLD, NEW-INBOUND, CONTACTED,
                 CONTACTED-PHONE, CONTACTED-EMAIL, PROSPECT, INACTIVE, RECLAIMED), email_deliverability
                 (GOOD/LOW/BAD), phone_dnd_status, org_id, recycled_from_deal_id, lost_reason, lost_stage,
                 eligible_for_reengagement_at
SavedList      — reusable lead segments, decoupled from any one workflow
Organization   — name, enabled_features[], product_context, brand_voice_guidelines_id, sending_domains[]
                 (an org can have multiple sending domains — Aeon Miles sometimes sends from the Aeon
                 Synergies domain — never assume 1:1 org-to-domain)
WorkflowTemplate — org-scoped, requires_warmup flag, steps[] (email | call_task | sms | wait)
Enrollment     — Lead × WorkflowTemplate instance: current step, status (active/paused/completed/exited)
EmailTemplate  — org-scoped, ab_group_id, current_version_id
EmailTemplateVersion — subject_line, body_html, image_blocks[], image_policy (always/never/auto),
                 generation_source (ai/human/ai_edited_by_human), ai_draft_snapshot,
                 status (DRAFT → PENDING_APPROVAL → APPROVED | REJECTED → RESUBMITTED),
                 ai_generation_metadata { reference_templates[], reason }
ReviewTask     — auto-created when a template/workflow change needs human approval
LeadActivity   — kind: email | call | sms | meeting | task | note; links lead_id, workflow enrollment + step
SendTimePerformance — rollup: org_id, workflow_type, persona, day_of_week, hour_bucket, timezone_bucket,
                 content_variant_id, sent_count, reply_rate, meeting_rate, sample_size
UserAccessGrant — { user_id, app: "markflow"|"onboard", org_id (null = all orgs), role, features[] }
```

## Go-live status: SendGuardrail data sources

**Resolved as of PR #17.** Bounce/reply detection is live via a mailbox poller (`mailboxPoller.service.ts`, 5-min BullMQ job) — heuristic classification, not full RFC 3464/5965 parsing (the provider abstraction only exposes decoded body text, not raw MIME parts; revisit if that ever changes). Minimum sample size raised to 100.

**Spam-complaint visibility — researched, decided:**
- **Yahoo/AOL Complaint Feedback Loop**: realistically integrable now, no new code needed — classifier already handles the shape. **Remaining: enroll each sending domain's DKIM signing domain at Sender Hub (ops task, not code)** — confirm each domain's DKIM is actually configured first.
- **Google Postmaster Tools**: aggregate-only (30-day domain-wide rate, no per-message signal) — low value during ramp-up, worth doing eventually as a separate, lower-priority project, different ingestion shape than `DomainSendEvent`.
- **Microsoft SNDS/JMRP**: not usable given current architecture — requires registering dedicated sending IPs, and sends go through Graph/Gmail/Zoho's shared multi-tenant IPs. Only relevant if MarkFlow ever sends over its own dedicated IP/SMTP relay.

## Go-live status: AI analytics/optimization + A/B testing (Phase 6)

**Built.** `emailPerformanceAnalysis.service.ts` runs a diagnosis-by-symptom waterfall over every `EmailTemplate`'s live (`current_version_id`) version, in delivery-funnel order, stopping at the first symptom found: `high_bounce_rate` → `low_open_rate` (relative to this org's own baseline, never absolute) → `no_click_through` → `no_reply_after_click`. Scheduled daily via `emailAnalyticsQueue.ts`/`emailAnalyticsWorker.ts` (`runEmailPerformanceAnalysis` in `emailOptimization.service.ts`), also callable on demand.

- `high_bounce_rate` never produces a content suggestion — it opens a `ReviewTask` (`kind: 'email_version_deliverability'`) so a human investigates the version itself, separate from whatever SendGuardrail is doing about the domain overall.
- Every other symptom produces a new `EmailTemplateVersion` in `DRAFT` status, under a brand-new variant `EmailTemplate` sharing the incumbent's `ab_group_id` — never replacing the incumbent outright. `ai_generation_metadata.reason` states the diagnosis symptom, the metrics behind it, and the model's own stated angle. Same `PENDING_APPROVAL` human-in-the-loop gate as Phase 3 — a diagnosis-driven draft is never auto-applied.
- Per-send open/click tracking is a new `EmailEngagement` model (one row per send), fed by a genuinely new open-tracking pixel (`GET /o/:token`, undocumented in the OpenAPI spec, matching the existing `/r/:token` click-redirect precedent) and the existing link-tracking redirect. Open rate is used **only** as a weak, this-org's-own-baseline-relative comparison — never as an absolute threshold, and never conflated with "response rate" (rule #1 below still holds: that's reply rate / meeting-booked only).
- A/B testing: `abTesting.service.ts`. `ensureAbGroupId`/`createVariantTemplate` set up the group; traffic is split at **enrollment-snapshot time** (`resolveStepForEnrollment`, wired into `enrollment.service.ts`), not at send time — once resolved, the choice freezes into that enrollment's own steps snapshot, same "never latest" guarantee as everything else. A group with 0-1 live (`current_version_id` set) variants is a no-op. `promoteWinner` requires a template-approver role and throws `InsufficientAbTestSampleError` until every live variant clears the minimum sample size — never called automatically, since which variant wins is a strategy call, not a safety mechanism.

**Proposed numeric defaults — not yet reviewed, all in `src/constants/emailAnalytics.ts`:**

| Constant | Default | What it gates |
|---|---|---|
| `MIN_SAMPLE_SIZE_FOR_VERSION_ANALYSIS` | 30 sends | Below this, a version isn't diagnosed at all (mirrors SendGuardrail's minimum-sample-size principle) |
| `MIN_DENOMINATOR_FOR_SUBRATE` | 10 | Minimum opens (for click-through) / clicks (for reply-among-clickers) before that sub-rate is trusted |
| `MIN_BASELINE_COMPARABLE_VERSIONS` | 3 versions | Minimum number of this org's other sufficiently-sampled versions needed before a baseline open rate is trusted enough to diagnose `low_open_rate` against |
| `LOW_OPEN_RATE_RELATIVE_THRESHOLD` | 0.75× baseline | How far below the org's own average open rate counts as "low" |
| `LOW_CLICK_THROUGH_RATE` | 10% | Click-through rate (of opens) below which `no_click_through` fires |
| `LOW_REPLY_AMONG_CLICKERS_RATE` | 5% | Reply rate (of clickers) below which `no_reply_after_click` fires |
| `AB_TEST_MIN_SAMPLE_SIZE_PER_VARIANT` | 200 sends | Minimum sends per variant before `promoteWinner` will allow a decision |
| `EMAIL_ANALYTICS_POLL_INTERVAL_MS` | 24 hours | How often the scheduled analysis run fires — daily, not the mailbox poller's 5 minutes, since content performance doesn't need minute-level reaction |

The `high_bounce_rate` check reuses SendGuardrail's own `THROTTLE_BOUNCE_RATE` rather than a separate threshold, so the two systems agree on what "too many bounces" means.

## The three things that must never be violated

1. **"Response rate" means reply rate / meeting-booked, never open rate**, anywhere in analytics or optimization logic. Opens are unreliable (Apple MPP, Gmail proxy caching).
2. **Human-in-the-loop gates are real gates**: AI-generated template content and AI-suggested workflow/optimization changes sit in `DRAFT`/`PENDING_APPROVAL` until a human with the right role approves — never auto-applied. Exception: sending guardrails (domain warmup/throttling) can act autonomously — safety mechanism, not a content/strategy judgment call.
3. **A `WorkflowStep` pins to a specific `email_template_version_id`, never "latest."** Editing a template must never silently change a sequence already enrolling leads.

## RBAC, condensed

| Role | MarkFlow access |
|---|---|
| Super Admin / Admin | Full, all orgs |
| BD Admin | Full |
| BD Manager | Full lead + workflow access |
| BD-Lead Gen | Upload/monitor leads only — no workflow, no email/call access |
| BD-Sales | Full workflow access (build, run) |

Recycled/Win-back lead segment visible to: BD-Sales, BD-Manager, Admin only.

## Integration points and current status

| Integration | Status | Notes |
|---|---|---|
| Microsoft 365 (Aeon Synergies domain) | **Credentials in repo secrets** — ready to build | `MS_CLIENT_ID` / `MS_TENANT_ID` / `MS_CLIENT_SECRET`. Confirm admin consent was granted on Mail.Send/Mail.Read before wiring in — without it the adapter fails at runtime with a permissions error, not at setup. |
| Google Workspace (Aeon Miles domain) | **Credentials in repo secrets** — ready to build | `GOOGLE_SERVICE_ACCOUNT_JSON` (domain-wide delegation). Required an org-policy exception (`iam.disableServiceAccountKeyCreation`) scoped to the project to issue the key. |
| Zoho Mail (Aeon Sign, Aeon Scheduler domains) | **Credentials in repo secrets** — ready to build | `ZOHO_CLIENT_ID` / `ZOHO_CLIENT_SECRET` / `ZOHO_REFRESH_TOKEN`, from the Self Client registration (not the Server-based one — that registration is unused). |
| Zoom Phone SMS | **Blocked — deferred** | `phone_sms:write:admin` (the intended scope) doesn't appear in this account's Server-to-Server app scope picker — matches an active, currently-unresolved Zoom developer forum report of the same gap, not a setup error. Support ticket pending. Fallback identified but not yet implemented: send via **Zoom Contact Center**'s SMS API (`contact_center:write:sms:admin`, which this account does have) instead of Zoom Phone's endpoint — different product, different endpoint/payload shape, needs its own lookup before building. Do not build the Phone-based SMS adapter against this account yet. Call-log read scopes (`phone:read:call_log:admin`, `phone:read:list_call_logs:admin`) are already granted and usable independent of the SMS question, for the call-outcome-logging feature. |
| Aeon Scheduler | URL-only for now | "Discovery Meeting Scheduled" is an abstract event — Phase 1 raises it manually; swap in the webhook later without redesigning anything downstream |
| Aeon Sign | Not needed for MarkFlow | Onboard-only integration |
| GA4 / Microsoft Clarity | Deliberately deferred | Revisit only if templates start linking to marketing pages instead of direct booking/reply actions |

## Build order

1. **Foundation**: `Organization` entity, `org_id` scoping, `Contact`/`Lead` split, `UserAccessGrant` model — pure schema work, only needs a MongoDB connection
2. **Email sending infrastructure**: multi-provider adapters (Graph/Google/Zoho), domain routing, click-tracking redirects — no AI yet
3. **AI template assistant**: draft → `EmailTemplateVersion` → human review gate, grounded in Brand Voice guidelines + Winning Email Library (seed from the Aeon Sign/Aeon Miles templates already provided) + Lead's own thread for replies
4. **Visual workflow builder** (React Flow) + enrollment engine, tied to approved template versions
5. **Domain warmup + AI sending guardrails**
6. **AI analytics/optimization + A/B testing**: diagnosis-by-symptom (bounce → deliverability, not content; low opens → subject line; opened-no-click → body; clicks-no-reply → CTA/timing)
7. **Send-time/content-pattern optimization**: configurable manual/ai_suggested/ai_automatic, always subordinate to the guardrail service
8. **Multi-org rollout**: image-placeholder policy, cross-org insight sharing (abstracted patterns only)

## Seed material available

Six uploaded documents contain real, in-voice templates for Aeon Sign and Aeon Miles — seed the Brand Voice guidelines and Winning Email Library from these rather than generating from scratch. Aeon Sign: persona-segmented sequences (Amazon DSP/AFP, FedEx ISP, Other Logistics), Day 1→3→7→14→21/28 cadence, product story "Send → Collect → Track → Store." Aeon Miles: mixed-channel sequence (Email→Email→Call→Email→Email→Call) with exit-condition and win-back logic already built into the human playbook. No existing material for Aeon RecruitPro or Aeon Scheduler — cold start for those.

## Org product context

- **Aeon Miles**: Amazon DSP back-office suite (payroll, bookkeeping, disputes, analytics, dispatch, recruitment). Sub-brands: Aeon Finance, Aeon Fleet, Aeon Flow.
- **Aeon Sign**: e-signature/document workflow — logistics HR documentation for DSP/FedEx ISP operators, broader contract/approval use case for other logistics companies.
- **Aeon RecruitPro**: standalone generic recruitment/ATS platform — genuinely separate market from Aeon Miles despite internal fulfillment overlap.
- **Aeon Scheduler**: Calendly-style scheduling SaaS with built-in payment collection.

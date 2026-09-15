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

## ⚠️ Blockers before real cold-sending volume — do not miss

- **`SendGuardrail`'s reputation-based safety net** (Phase 5, PR #14 + the mailbox-poller follow-up):
  1. ✅ **Done** — NDR/bounce parsing via mailbox polling (`fetchNewMessages`, every 5 min per configured mailbox — see `src/services/mailboxPoller.service.ts`). Heuristic classification (sender/subject/body patterns), not full RFC 3464 parsing — `InboundMessage` only exposes decoded body text/html, not raw MIME parts, so the machine-readable `message/delivery-status` part usually isn't reachable. Good enough to gate sending; revisit if the provider abstraction ever exposes raw MIME.
  2. ✅ **Done** — Reply detection via the same poller, correlated to `Lead`/`Enrollment` primarily by `LeadActivity.provider_thread_id`, falling back to matching the sender's address against a `Contact`. Only logged/counted when it correlates to a known lead — unattributed inbound mail is left alone (this mailbox is also a real, human-monitored inbox; the poller never marks non-deliverability mail as read).
  3. ⚠️ **Spam-complaint visibility — mixed, see below.** Real per-message complaint signal is realistically integrable *now* for Yahoo/AOL; Google and Microsoft are not, for different reasons.
  4. ✅ **Done** — Minimum sample size raised from 20 to 100 sends in the window (`GUARDRAIL_MIN_SAMPLE_SIZE`) now that real data exists to be noisy.
- Bounce/reply signals are live. **Spam-complaint signals are only partially live** (Yahoo/AOL, once enrolled) — don't let later phases (A/B testing, send-time optimization) assume Google/Microsoft complaint data exists.

### Spam-complaint visibility: what's actually integrable (researched 2026-09)

| Source | Scope | Data shape | Setup | Verdict |
|---|---|---|---|---|
| **Yahoo/AOL Complaint Feedback Loop** (via [Sender Hub](https://senders.yahooinc.com/complaint-feedback-loop/)) | Per-message, as an ARF-formatted email | Same shape as a bounce — lands as email in a mailbox we choose | Enroll your **DKIM signing domain** (the `d=` value + selector) at Sender Hub, verify it, done. Domain-based, not IP-based. | **Realistically integrable now.** Reuses the exact mailbox-poller shipped in this PR — `classifySystemMessage`'s complaint heuristics (sender contains feedback/fbl/abuse, or body contains `Feedback-Type: abuse`) already match Yahoo's ARF shape. No new code needed, only the Sender Hub signup — **but confirm each sending domain's DKIM is actually configured in its M365/Google Workspace/Zoho tenant first**, since CFL enrollment is keyed off the DKIM `d=` domain, not the mailbox address. |
| **Google Postmaster Tools** | Aggregate only — a domain-wide spam-rate % over a rolling 30-day window, no per-message signal | Daily aggregate, not an event | Verify the domain via DNS TXT/CNAME (the **DKIM or SPF/Return-Path domain**, not necessarily the visible From domain) — a one-time human step, done at postmastertools.google.com. Has a REST API once verified (OAuth2/service-account auth), but needs *sufficient send volume* before any data appears at all — won't show anything meaningful during ramp-up. Gmail's own API version is in flux (a v1 API exists today; a v2 with more fields is rolling out) — check current docs before building against it. | **Not integrable as a per-event signal, and low value until volume ramps.** No per-message complaint report exists for Gmail at all — this dashboard/API is the *only* Gmail complaint signal, ever. Worth doing eventually for domain-reputation visibility generally (bounce/auth-pass-rate too), but it's a separate ingestion shape (periodic snapshot, not `DomainSendEvent`) and a separate, lower-priority project — not part of this PR. |
| **Microsoft SNDS / JMRP** | Per-*IP*, not per-domain | IP reputation dashboard + complaint sample data | Register the specific sending IP(s) you're "responsible for" and prove ownership. As of a Feb-2026 modernization, JMRP feeds are now tied to an SNDS account too. | **Not realistically integrable for how we send.** We send via Microsoft Graph / Gmail API / Zoho on each provider's own shared multi-tenant infrastructure IPs — we don't control or "own" those IPs, so there's nothing to register. This would only become relevant if MarkFlow ever sent over its own dedicated IP/SMTP relay instead of these APIs. |

**Recommendation**: enroll each sending domain's DKIM signing domain in Yahoo/AOL's Complaint Feedback Loop as the near-term real complaint signal (ops task, not code — the poller already handles the rest). Revisit Google Postmaster Tools later as a separate, lower-priority domain-reputation-dashboard project once send volume justifies it. Skip Microsoft SNDS/JMRP unless MarkFlow's sending architecture changes to use dedicated IPs.

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

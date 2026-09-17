# Aeon MarkFlow — Build Brief for Claude Code

Working context for building **Aeon MarkFlow**, Aeon Synergies' sales & marketing engagement platform. Companion to **Aeon Onboard** (`AeonSynergies/aeon-onboard`, `AeonSynergies/aeon-onboard-backend`) — currently being cloned and migrated from Vercel (internal-testing only, no live data) to the same new AWS account MarkFlow will live in, with schema additions layered on top rather than a rewrite.

Full reasoning for every decision below lives in `docs/requirements.md` (30 sections) — ask for it if something here needs more depth.

## What this app is

MarkFlow owns everything **before** a deal is priced: Leads, the marketing/engagement workflow engine (email/call/SMS sequences), and Discovery call management. The moment a Discovery Meeting is *scheduled* (not at any later outcome — see the Discovery handoff timing note further down), a Deal hands off to Aeon Onboard, which owns Discovery itself, pricing, contracts, payment, and client management from there. MarkFlow never touches pricing, contracts, or billing.

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

✅ **Bounce/reply detection — done** (PR #17). `mailboxPoller.service.ts`, every 5 min per configured mailbox via `fetchNewMessages`. Heuristic classification (sender/subject/body patterns), not full RFC 3464 parsing — `InboundMessage` only exposes decoded body text/html, not raw MIME parts. Replies correlate via `LeadActivity.provider_thread_id`, falling back to sender-address matching; only counted when attributable to a known lead. Never marks non-deliverability mail as read (these are real, human-monitored inboxes too).

✅ **Minimum sample size raised 20 → 100** (`GUARDRAIL_MIN_SAMPLE_SIZE`).

⚠️ **Spam-complaint visibility — mixed, researched 2026-09:**
- **Yahoo/AOL Complaint Feedback Loop**: realistically integrable now, zero new code — the poller's existing complaint heuristics already match ARF's shape. Remaining: enroll each domain's DKIM signing domain (the `d=` value + selector) at Sender Hub — an ops task, keyed off DKIM not the mailbox address, so confirm DKIM is actually configured per-tenant first.
- **Google Postmaster Tools**: aggregate-only (30-day domain-wide rate, no per-message signal) — the *only* Gmail complaint signal that exists at all. Needs DNS verification + sufficient volume before any data appears. Gmail's Postmaster API is mid-transition (v1 live, v2 rolling out) — check current docs before building. Separate, lower-priority project (different ingestion shape — periodic snapshot, not `DomainSendEvent`).
- **Microsoft SNDS/JMRP**: not usable — per-IP, requires registering *owned* sending IPs; MarkFlow sends via Graph/Gmail/Zoho's shared multi-tenant infrastructure, nothing to register. Only relevant if sending architecture ever moves to a dedicated IP/SMTP relay.

Bounce/reply signals are fully live. Spam-complaint signal is only partial (Yahoo/AOL, once DKIM-enrolled) — don't let later phases assume Google/Microsoft complaint data exists.

## Domain purpose model — refines `Organization.sending_domains[]`

Each org uses subdomains by purpose, not one flat domain per org: `mail.*` for marketing (MarkFlow's workflow engine sends), main domain for transactional (existing nodemailer system, untouched), `alert.`/`notify.*` for system alerts. `sending_domains[]` should be `{ domain, purpose: "marketing" | "transactional" | "alerts" }[]`, not a flat string array — `DomainRouter` needs to pick by purpose, not just by org. **MarkFlow's own internal notifications** (`ReviewTask` alerts, `SendGuardrail` pause notifications) should route through the `alerts` purpose domain, not the `marketing` one — don't mix internal notification sending with cold-outreach sending reputation.

## Yahoo/AOL CFL — deprioritized, not abandoned

DKIM setup continues regardless (valuable for deliverability to every provider). The Sender Hub CFL *signup* step specifically is deprioritized: it only yields complaint signal for Yahoo/AOL-hosted recipients, and very few leads use those addresses given the ICP. Revisit if the lead mix ever shifts toward more consumer webmail.



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

---

## Role restructuring: BD-Marketing (new) + BD-Sales (narrowed) + BD_ADMIN inclusion

- **BD-Marketing** (new, MarkFlow-only): full workflow building, email/social channels, AI template approval. Replaces BD-Sales in `TEMPLATE_APPROVER_ROLES` and (pending confirmation) `RECYCLED_SEGMENT_ROLES`.
- **BD-Sales** (narrowed, spans both apps): MarkFlow — calling, discovery/onboarding meeting scheduling, entering pricing after discovery (see handoff-timing note below — likely moves to Onboard entirely). Onboard — negotiation, deal actions, pricing continuation.
- **BD_ADMIN**: now included in `TEMPLATE_APPROVER_ROLES` and `SendGuardrail`'s domain-resume gate — resolves the hierarchy inversion where BD Admin (above BD Manager) couldn't do something BD Manager could.
- Updated `TEMPLATE_APPROVER_ROLES`: `[SUPER_ADMIN, ADMIN, BD_ADMIN, BD_MANAGER, BD_MARKETING]` (was `[..., BD_MANAGER, BD_SALES]`).

## On-demand AI draft creation — approved, build it

The AI-draft-creation flow (`createAiDraftVersion`) currently has no HTTP route — only the automated Phase 6 diagnosis job can trigger it internally. Add a route so BD-Marketing/BD Manager/BD Admin/Admin/Super Admin can request a draft on demand (persona, workflow position, brief/goal as input), not just receive automated proposals.

## Discovery handoff timing, no-show/retry handling, and pricing location — finalized

**Handoff timing**: reverts to the original Deal Stage doc's literal trigger — fires at **Discovery Meeting Scheduled**, not at the "Interested" outcome. Deal created in Onboard the moment scheduling happens; Discovery itself is now Onboard's domain, not MarkFlow's.

**No-show / cancelled — immediate revert, not a timer sitting in Onboard**: fires the Lost+Recycle mechanism (§18) **right away**, landing the prospect back in MarkFlow with a new status: **`DISCOVERY_RETRY`**. This is a distinct, fast-cadence tier from the existing `RECLAIMED` win-back status — interest was already real enough to book a call, so this needs urgent, low-friction reschedule-focused follow-up, not a slow "maybe later this year" cadence. Living in MarkFlow (not Onboard) is deliberate: MarkFlow's workflow/reminder engine actively works it, so it can't get buried among real pricing/contract work the way it could sitting in Onboard's Deal list.

**Reschedule (before any no-show)**: stays in Onboard — just a status/time update via the Aeon Scheduler webhook, no cross-app event.

**`DISCOVERY_RETRY` successfully reschedules**: the handoff mechanism fires again normally — a new Deal is created in Onboard, Discovery resumes there.

**`DISCOVERY_RETRY` sits 30 days with no successful reschedule**: automatically graduates to the existing `RECLAIMED` status — same win-back mechanism from §18, slower cadence.

**"Follow-up Required"** (call happened, needs another conversation): stays in Onboard, same treatment as reschedule — not a revert.

**"Not Interested" (Lost after the call happened)**: Lost+Recycle mechanism, same as Price-Approval/Negotiation losses — one unified mechanism for every "didn't work out, might retry" case regardless of which stage it came from.

**Pricing entry**: happens directly in Onboard, once the Deal exists there from scheduling time onward. No MarkFlow pricing UI or cross-app sync channel — BD-Sales already has Onboard access under the dual-app RBAC model.

**New `lost_reason`/status vocabulary needed**: `DISCOVERY_RETRY` as a distinct `Lead.status` (fast tier, separate from `RECLAIMED`), plus reasons like `no_show`/`cancelled_discovery` feeding it, alongside the existing Lost reasons feeding `RECLAIMED` directly for post-call losses.

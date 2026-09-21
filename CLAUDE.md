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
- **`apprunner.yaml`** (repo root) — App Runner's native build config for the HTTP API server (`npm ci && npm run build`, then `npm run start`). `run.network.env: PORT` is what tells App Runner to inject its dynamically-assigned port into `process.env.PORT`, which `src/config/env.ts` already reads (`Number(process.env.PORT ?? 4000)`, no hardcoded value) — confirmed, not changed, since it was already correct. No secrets in this file; everything else the app needs (`MONGODB_URI`, `JWT_SECRET`, the email-provider credentials, ...) is configured on the App Runner service itself. **Covers the API server only.**
- **`apprunner-worker.yaml`** (repo root) — a second, separate App Runner service config for the BullMQ worker process (`npm run start:worker`, `src/worker.ts`). The worker itself does no HTTP work, but App Runner requires every service to be request-driven and health-checked — rather than moving it to a different platform (e.g. ECS/Fargate) just for that, `src/healthCheckServer.ts` starts a minimal `GET /health` HTTP server alongside the real worker/scheduler logic, existing solely to give App Runner's health check something to respond to; the actual work (BullMQ workers, repeatable job schedulers) is completely unchanged. **When creating this second App Runner service, its health check path must be set to `/health`** (App Runner's default health-check path, `/`, isn't served here) — a service-level setting, not something `apprunner-worker.yaml` itself can configure. Closes the gap the original `apprunner.yaml` PR flagged rather than attempted.

## Core entities (Mongoose-shaped)

```
Contact        — shared across orgs: name, company (both free-text — see "Leads screen backend"
                 below), email, phone, timezone (IANA name, nullable — send-time optimization
                 resolves to this, never the server's own timezone), firmographics
                 (dsp_code, drivers, vans, stations), global_do_not_contact (hard suppress override —
                 set autonomously by an AI-classified unsubscribe_request reply, its only writer;
                 checked by enrollSavedList before every new Enrollment, its only reader; see "AI
                 reply-intent classification" below)
Lead           — one per (Contact, Organization): status enum (NEW-COLD, NEW-INBOUND, CONTACTED,
                 CONTACTED-PHONE, CONTACTED-EMAIL, PROSPECT, INACTIVE, RECLAIMED), email_deliverability
                 (GOOD/LOW/BAD), phone_dnd_status, org_id, recycled_from_deal_id, lost_reason, lost_stage,
                 eligible_for_reengagement_at; listable/filterable/searchable via
                 `GET /orgs/{orgId}/leads` — see "Leads screen backend" below
SavedList      — reusable lead segments, decoupled from any one workflow; created_by now populated
                 (the Leads screen's bulk "add to SavedList" action, `POST /orgs/{orgId}/saved-lists`
                 and `POST /orgs/{orgId}/saved-lists/{id}/leads` — its only writer so far)
Organization   — name, enabled_features[], product_context, brand_voice_guidelines_id (unused/
                 dangling — see BrandVoiceGuidelines below),
                 sending_domains[] { domain, purpose: "marketing" | "transactional" | "alerts",
                 mailboxes[] { address, display_name, status: "active" | "inactive" } }
                 (an org can have multiple sending domains, each tagged with its own purpose — Aeon
                 Miles sometimes sends from the Aeon Synergies domain — never assume 1:1 org-to-domain
                 or one purpose per org; each domain/purpose entry can in turn list several mailboxes,
                 round-robinned across at send time — see "Mailbox model" below), send_time_strategy
                 ("manual" | "ai_suggested" | "ai_automatic", default "manual" — org-level, not
                 per-template; see Phase 7 below); enabled_features/sending_domains/send_time_strategy
                 readable/writable via `GET/PATCH /orgs/{orgId}/organization` — see "Settings screen
                 backend" below
GuardrailSettings — per-(org, domain) override of any of SendGuardrail's ramp-up numbers/thresholds
                 (see src/constants/sendGuardrail.ts's field list) — every field optional, unset
                 means "use the hardcoded default"; see "Settings screen backend" below
BrandVoiceGuidelines — the single current Brand Voice guidelines document (text + a content-hash
                 version), DB-backed as of the Settings screen — see "Settings screen backend" below
WorkflowTemplate — org-scoped, requires_warmup flag, workflow_type (free-text category, e.g.
                 "cold_outreach" — rolls up send-time performance across templates of the same type),
                 steps[] (email | call_task | sms | wait)
Enrollment     — Lead × WorkflowTemplate instance: current step, status (active/paused/completed/exited);
                 snapshots workflow_type (from the template) and send_time_strategy (from the org) at
                 enrollment time, same "never latest" reasoning as requires_warmup; assigned_mailboxes[]
                 { domain, mailbox } — one mailbox per distinct sending domain among its own steps,
                 assigned once at enrollment creation and reused for every send, not re-resolved per
                 step (see "Mailbox model" below); exit_reason/status "exited" set by
                 exitEnrollment()/exitAllActiveEnrollmentsForLead() (enrollment.service.ts) — an
                 interested or unsubscribe_request reply classification, today; see "AI reply-intent
                 classification" below
EmailTemplate  — org-scoped, ab_group_id, current_version_id, persona, workflow_position (e.g.
                 "cold_open", "follow_up_1", "win_back_intro" — matches the Winning Email Library
                 seed's own categories), intended_workflow_type (which WorkflowTemplate.workflow_type
                 category, e.g. "cold_outreach", this template is meant for) — all three free-text,
                 no backing enum; filterable via `GET /orgs/{orgId}/email-templates`, which also
                 doubles as the workflow builder's template-picker query (see below)
EmailTemplateVersion — subject_line, body_html, image_blocks[] { block_id, alt_text, placeholder_src },
                 image_policy (always/never/auto — "auto" is enforced at send time by
                 imagePolicy.service.ts, Phase 8), generation_source (ai/human/ai_edited_by_human),
                 ai_draft_snapshot, status (DRAFT → PENDING_APPROVAL → APPROVED | REJECTED → RESUBMITTED),
                 ai_generation_metadata { reference_templates[], reason }
ReviewTask     — auto-created when a template/workflow change (or a send-time recommendation, Phase 7)
                 needs human approval; also auto-created as an after-the-fact record (kind
                 lead_unsubscribe_request) when SendGuardrail-style autonomous action has already
                 happened — not itself a pending approval gate, see "AI reply-intent classification"
LeadActivity   — kind: email | call | sms | meeting | task | note; links lead_id, workflow enrollment + step;
                 an inbound email reply carries ai_reply_classification { intent, confidence,
                 reasoning, model, classified_at } once classified — see below
SendTimePerformance — rollup: org_id, workflow_type, persona, day_of_week, hour_bucket, timezone_bucket,
                 content_variant_id, sent_count, reply_rate, meeting_rate, sample_size
SendTimeRecommendation — a proposed or applied (day_of_week, hour_bucket, timezone_bucket,
                 content_variant_id) pairing for one (org, workflow_type, persona) group; status
                 OPEN → APPROVED | REJECTED, or APPROVED → SUPERSEDED when a better one replaces it
RecipientProviderCategory — per-domain cache (Phase 8): consumer webmail vs. corporate/enterprise,
                 fed by an MX lookup, used only by the "auto" image policy
CrossOrgInsight — an abstracted structural/timing pattern (Phase 8) observed across at least
                 MIN_ORGS_FOR_INSIGHT distinct orgs' own WorkflowTemplate/SendTimePerformance data —
                 sequence_shape, step_count, or send_time_window; never one org's raw content
UserAccessGrant — { user_id, app: "markflow"|"onboard", org_id (null = all orgs), role, features[] };
                 list/create/update via `/orgs/{orgId}/user-access-grants` — see "Settings screen
                 backend" below
```

## Go-live status: SendGuardrail data sources

✅ **Bounce/reply detection — done** (PR #17). `mailboxPoller.service.ts`, every 5 min via `fetchNewMessages`, across **every actual sending mailbox**, not one per domain: `pollAllMailboxes`'s `resolveMailboxesForDomain` unions every org's `sending_domains[].mailboxes[]` configured for a deployment-registered domain, falling back to `DOMAIN_PROVIDER_MAP_JSON`'s single default mailbox only when no org has configured any of its own yet (same fallback `DomainRouter` itself uses). Before this, only that one deployment-level default per domain was ever polled, so bounces/complaints/replies landing in any second configured mailbox went completely undetected. Heuristic classification (sender/subject/body patterns), not full RFC 3464 parsing — `InboundMessage` only exposes decoded body text/html, not raw MIME parts. Replies correlate via `LeadActivity.provider_thread_id`, falling back to sender-address matching; only counted when attributable to a known lead. Never marks non-deliverability mail as read (these are real, human-monitored inboxes too). A failure on one mailbox (bad credentials, provider outage) is logged and skipped, never blocking any other mailbox's poll.

✅ **Minimum sample size raised 20 → 100** (`GUARDRAIL_MIN_SAMPLE_SIZE`).

⚠️ **Spam-complaint visibility — mixed, researched 2026-09:**
- **Yahoo/AOL Complaint Feedback Loop**: realistically integrable now, zero new code — the poller's existing complaint heuristics already match ARF's shape. Remaining: enroll each domain's DKIM signing domain (the `d=` value + selector) at Sender Hub — an ops task, keyed off DKIM not the mailbox address, so confirm DKIM is actually configured per-tenant first.
- **Google Postmaster Tools**: aggregate-only (30-day domain-wide rate, no per-message signal) — the *only* Gmail complaint signal that exists at all. Needs DNS verification + sufficient volume before any data appears. Gmail's Postmaster API is mid-transition (v1 live, v2 rolling out) — check current docs before building. Separate, lower-priority project (different ingestion shape — periodic snapshot, not `DomainSendEvent`).
- **Microsoft SNDS/JMRP**: not usable — per-IP, requires registering *owned* sending IPs; MarkFlow sends via Graph/Gmail/Zoho's shared multi-tenant infrastructure, nothing to register. Only relevant if sending architecture ever moves to a dedicated IP/SMTP relay.

Bounce/reply signals are fully live. Spam-complaint signal is only partial (Yahoo/AOL, once DKIM-enrolled) — don't let later phases assume Google/Microsoft complaint data exists.

## AI reply-intent classification (`mailboxPoller.service.ts` / `replyIntentClassifier.service.ts`)

✅ **Built.** Every inbound reply the poller correlates to a known Lead (via `provider_thread_id`, falling back to sender-address matching — see above) is classified by Claude (`claude-opus-5`) into `interested` | `not_now` | `objection` | `wrong_person` | `unsubscribe_request` | `unclear`, with a confidence score and one-sentence reasoning, stored on the `LeadActivity` record (`ai_reply_classification`). Below `LOW_CONFIDENCE_THRESHOLD` (`src/constants/replyIntent.ts` — a proposed default, unreviewed), the result is downgraded to `unclear` regardless of what Claude said, so a human is never misled by a shaky label. A classification failure (API outage, malformed response) never blocks the reply pipeline itself — it falls back to `unclear` and the reply is still logged/counted either way.

This is a triage aid, not a content generator — it never drafts or sends anything on its own; a human still drafts any actual reply through the existing AI-template-assistant/approval flow. Two classifications drive further, narrowly-scoped autonomous action instead of just sitting on the record:

- **`unsubscribe_request`** sets `Contact.global_do_not_contact` and exits every active `Enrollment` for that lead (`exitAllActiveEnrollmentsForLead`) — the same human-in-the-loop exception as SendGuardrail's autonomous domain pause (a compliance/safety action, not a content/strategy judgment call), so it takes effect immediately. Mirrors `pauseDomain`'s own shape: mutate state, open a `ReviewTask` (`lead_unsubscribe_request` kind — a record for a human to review, not a pending approval gate), send an internal notification. Idempotent.
- **`interested`** exits the correlated `Enrollment` (`exitEnrollment`, reason `reply_interested`) — consistent with the Aeon Miles playbook's own instruction to move an interested lead out of automation immediately. A workflow-state transition, not content generation, so — like the engine's own existing autonomous "no more steps → completed" transition — it isn't gated behind human approval.

⚠️ **Two things worth flagging, found while building this (the first is now closed — see below):**
- `exitEnrollment`/`exitAllActiveEnrollmentsForLead` (`enrollment.service.ts`) are themselves new. `Enrollment.exit_reason`/`status: "exited"` have existed in the schema since Phase 4, and this file previously said exit-condition logic was "already built into the human playbook" — that referred to the uploaded seed *business* playbook documents, not existing MarkFlow code; no service anywhere actually moved an enrollment to `exited` before this.
- No read API yet: `ai_reply_classification` is stored and queryable in Mongo, but this backend has no `Lead`/`LeadActivity` HTTP routes at all (same gap as `Organization` — see "Domain purpose model" below) — nothing in-app surfaces a classified reply to a human yet. ✅ **Both closed now**: `GET /orgs/{orgId}/leads` (see "Leads screen backend" below) is a real `Lead` read API, and `GET/PATCH /orgs/{orgId}/organization` (see "Settings screen backend" below) is a real `Organization` read/write API. `LeadActivity` — and therefore `ai_reply_classification` itself — still has no HTTP route; that's a still-open gap, not attempted here.

✅ **`global_do_not_contact` is now enforced at enrollment time.** `Contact.global_do_not_contact` had no reader anywhere in this codebase when `unsubscribe_request` handling first started writing it — `enrollSavedList` (`enrollment.service.ts`) now checks it for every lead before creating an Enrollment (`isContactSuppressed`) and rejects a suppressed lead outright, reported back in the result's `rejections[]` (surfaced through `POST /orgs/{orgId}/workflow-templates/{templateId}/enrollments`'s response as `rejected_count`/`rejections`) rather than silently dropped or created anyway. This applies universally — there is no separate recycle/win-back enrollment path in this codebase to bypass it; every enrollment, a recycled lead's included, goes through `enrollSavedList`, so an explicit opt-out always overrides `eligible_for_reengagement_at`/`lost_reason`/`lost_stage`. Fails open (does not report suppression, matching this function's pre-existing behavior of trusting `SavedList.lead_ids` without validating each id) only when the Lead or Contact itself can't be found — a data-integrity gap that predates this check and isn't what it's trying to fix. Gating `sendWorkflowEmail` on the flag too, for defense in depth against some future second writer of `global_do_not_contact`, is unnecessary today: the only writer (`suppressContactForUnsubscribe`) already exits every active enrollment for that lead in the same operation, so no enrollment can ever be both active and suppressed.

## EmailTemplate browsing, filtering, and usage lookup

✅ **Built.** `EmailTemplate` gains `intended_workflow_type` (free-text, matching `WorkflowTemplate.workflow_type`'s own category values, e.g. "cold_outreach") alongside its existing `persona`/`workflow_position` fields — all three are free-text with no backing enum, same convention throughout this codebase (`workflow_type` itself has never had one either). `GET /orgs/{orgId}/email-templates` (already existed, previously took no filters at all) now accepts `persona`, `workflow_position`, `intended_workflow_type`, and `status` query filters — `status` matches templates with *at least one* version at that status (a join against `EmailTemplateVersion`, since `current_version_id` only ever reflects the most recently *approved* version and can't answer "has a DRAFT/PENDING_APPROVAL/REJECTED one").

**One endpoint serves two roles, deliberately not two separate ones.** Unfiltered, it's the browsable listing a management UI would use to show every template in the org (not just ones pending approval — it always did this; the gap was the missing filters, not missing breadth). Called with `status=APPROVED` plus whatever persona/workflow_position/intended_workflow_type context a step's inspector knows, it's also the workflow builder's own candidate-template picker — narrowing directly to templates that already have an approved, pinnable version (`current_version_id` is right there in the response) instead of listing every approved template in the org. There was no separate pre-existing "picker" endpoint to update: the prior flow was list-everything-unfiltered, then a separate per-template versions call — this single filtered endpoint replaces both steps for the picker's purposes.

`GET /orgs/{orgId}/email-templates/{templateId}/usages` is new: every `WorkflowTemplate` step currently pinned to any version of a template, computed live from `WorkflowTemplate.steps` on every call (no stored index) — meant to warn a human what would break before they edit or retire a template still in use. Deliberately never looks at `Enrollment.steps`: those are frozen per-enrollment snapshots (same "never re-resolved" reasoning as everywhere else in this codebase) that can't be broken by a live template change, so they're not a "current" usage by this endpoint's own definition.

## Leads screen backend (`GET /orgs/{orgId}/leads`, SavedList bulk actions)

✅ **Built.** `GET /orgs/{orgId}/leads` lists/filters/searches `Lead` for one org — `status` (any `LEAD_STATUSES` value), `segment=recycled` (see below), and `search` (case-insensitive substring match against the lead's `Contact` name/company). Open to every role with org access, including BD-Lead Gen — pure viewing, no workflow action.

**Two things this request assumed already existed but didn't, flagged here rather than silently built around or silently fixed without mention:**
- **`Contact` had no `name` or `company` field at all** before this — only `email`/`phone`/`timezone`/`firmographics`. "Search by name/company" needed something to search, so both are new free-text fields on `Contact` (identity facts, same reasoning as `email`/`phone` living there rather than on `Lead` — a person's name/employer doesn't change per org they're a lead for). Neither is backfilled; existing Contacts have both as `undefined` until captured.
- **There was no `Lead`/`SavedList` HTTP route domain at all** before this (flagged as an open gap in "AI reply-intent classification" above) — `GET /orgs/{orgId}/leads` and the `SavedList` endpoints below are new route files (`lead.routes.ts`, `savedList.routes.ts`), not extensions of something pre-existing.

**Recycled/Win-back segment**: `segment=recycled` forces `status: { $in: ['RECLAIMED', 'DISCOVERY_RETRY'] }` (ignoring any `status` filter also passed) and the response's `lost_reason`/`lost_stage` are populated for those rows the same way they already are for every other `Lead` — there's no separate response shape. Gated to `RECYCLED_SEGMENT_ROLES` — any other role requesting it gets a 403, not a silently-empty or silently-unfiltered result. This is a query-time check inside the handler, not a route-level `requireRole`, since it's a filter on one endpoint rather than a separate one. (This paragraph itself doesn't repeat `RECYCLED_SEGMENT_ROLES`'s membership since that's already drifted here once — see the RBAC table below and the constant's own comment for the current, real answer.) For the write side that actually populates `RECLAIMED`/`DISCOVERY_RETRY` in the first place, see "DISCOVERY_RETRY status, the Lost+Recycle receiving endpoint..." further down — this GET endpoint predates that by a fair bit and could only ever read fields nothing yet wrote.

**Contact is shared across orgs — the response is always this org's own Lead, never leaked from another.** `search` resolves matching `Contact._id`s first, then queries `Lead.find({ org_id, contact_id: { $in: ... } })` — every field in the response (status, lost_reason, lost_stage, ...) comes from *this org's* `Lead` document. A Contact who's a Lead in two orgs can never surface one org's Lead state while being searched from the other's Leads screen.

**Bulk actions**, both workflow-related per the RBAC table (`WORKFLOW_ACCESS_ROLES` — same access as building/running a workflow; BD-Lead Gen gets neither):
- `POST /orgs/{orgId}/saved-lists` (optionally seeded with `lead_ids`) and `POST /orgs/{orgId}/saved-lists/{id}/leads` — "enroll selected leads into a SavedList," new-list and add-to-existing paths respectively. `GET /orgs/{orgId}/saved-lists` lists an org's SavedLists (needed for a UI to offer an existing list to add to, or to pick a list for the next action). Every `lead_ids` entry is checked against `Lead.find({ _id: { $in }, org_id })` before being trusted — an id for a Lead in a different org (or a nonexistent id) is dropped, reported via `skipped_count`, never silently added.
- "Enroll a SavedList directly into a WorkflowTemplate" — **already built and exposed**, nothing new needed: `POST /orgs/{orgId}/workflow-templates/{templateId}/enrollments` (`enrollment.service.ts`'s `enrollSavedList`, PR #26) already does exactly this.

No pagination on `GET /orgs/{orgId}/leads` — matches every other list endpoint in this codebase (`workflow-templates`, `email-templates`), none of which paginate either. Worth revisiting before a large org's Leads screen ships, since Lead volume is likely to dwarf template counts.

## `GET /me` — the frontend's own identity/access endpoint

✅ **Built**, not originally part of any backend phase — added because the frontend's navigation shell (org switcher + role-gated nav links) has no way to work without it. The shared JWT carries only `sub`/`email` (see `auth.middleware.ts`); nothing anywhere told a client which orgs a user can access or what role they hold until they already knew an `orgId` to call an org-scoped endpoint with — a chicken-and-egg gap. `GET /me` (no `:orgId`, just `requireAuth` + `attachOrgScope`) returns the caller's own identity, `org_access` (`all_orgs`, `roles`), and the resolved `orgs: [{id, name}]` list to populate a switcher from.

**`org_access.roles` is the same flat, not-per-org set `requireRole` itself already checks** (`orgAccess.service.ts`'s `getOrgAccessForUser` collapses every grant's role into one `Set` regardless of which org it's for) — not a "this role for this org" breakdown. A user holding `BD_SALES` in one org and `BD_LEAD_GEN` only in another would, today, pass `requireRole(WORKFLOW_ACCESS_ROLES)` on *either* org's workflow endpoints, because the check never looks at the target org at all. This is a real pre-existing architectural simplification in the backend's own RBAC middleware, not something introduced or fixed here — deliberately not attempted in this change, since fixing it would mean touching every already-shipped `requireRole` call site's semantics, unrequested and risky. `GET /me` mirrors it exactly rather than inventing a more correct per-org shape the backend doesn't actually enforce — so a frontend nav link hidden/shown from this endpoint always matches what the backend would actually allow, for better or worse.

`org_access.roles`' OpenAPI schema hardcodes its own copy of the role enum (`src/config/openapi.ts`, independent of the `ROLES` constant — same pattern as `UserAccessGrant`'s enums). This was written before `BD_MARKETING` existed and briefly went stale relative to `main` once it did; fixed here, while merging this PR forward past that change, to include `BD_MARKETING` too. Same drift risk as `TEMPLATE_APPROVER_ROLES`'s own table row above — this hardcoded copy isn't the source of truth either, `ROLES` is.

## Settings screen backend

✅ **Built.** Four independent pieces, all gated to `ADMIN_ONLY_ROLES` (Super Admin/Admin only — see the new RBAC rule above): org configuration, `UserAccessGrant` management, SendGuardrail's ramp-up/threshold overrides, and Brand Voice guideline editing.

**Org configuration** — `GET/PATCH /orgs/{orgId}/organization` (`organizationSettings.service.ts`), closing the `Organization` HTTP-route gap flagged in "AI reply-intent classification" above (there were none at all before this). `PATCH` only ever touches `enabled_features[]`, `sending_domains[]`, and `send_time_strategy` — exactly what was asked for, nothing else: `name`, `product_context`, and `brand_voice_guidelines_id` are left alone (the last one is dangling anyway — see below). `sending_domains`, if given, fully replaces the array — same semantics as a `WorkflowTemplate`'s own `steps` field (`.set('sending_domains', ...)`, not a merge). `OrganizationNotFoundError` (`enrollment.service.ts`, reused rather than redeclared) existed since `enrollSavedList`'s own org lookup but had no HTTP status mapping — nothing had ever made it reachable from a route before this — added to `httpErrors.ts` alongside a new `UserAccessGrantNotFoundError`.

**UserAccessGrant management** — `GET/POST /orgs/{orgId}/user-access-grants` (list is org-scoped-or-global: `{org_id: orgId} OR {org_id: null}`, since an all-orgs grant affects this org's access too) and `PATCH /orgs/{orgId}/user-access-grants/{grantId}` (role/features only — `app`/`org_id`/`user_id` are immutable after creation, since the model's own unique index is on that exact triple; changing any of them is really a different grant). List/create/update responses denormalize the granted user's email for display. **A grant can never scope wider than the caller's own access** — enforced in the route layer, not asked for explicitly but a direct, unavoidable consequence of "only Admin/Super Admin can grant access": creating a grant with `org_id: null` (all orgs) requires the caller to already hold `allOrgs` access themselves; creating one for a different org than the URL's requires `canAccessOrg` on that org too. Without this, an Admin scoped to one org could hand out access to every org in the system, which "only Admin/Super Admin can grant access" was never meant to permit.

**SendGuardrail settings — the one that needed the most care.** `GuardrailSettings` (new model) holds a per-(org, domain) override of any of the 11 numbers in `src/constants/sendGuardrail.ts` (ramp-up starting/steady-state cap, step multiplier/interval, both rolling-window sizes, min sample size, throttle/hard-stop bounce/complaint rates) — every field optional, and unset is not the same as zero. `guardrailSettings.service.ts`'s `resolveGuardrailSettings(orgId, domain)` is the *only* place `sendGuardrail.service.ts` reads these numbers from now (`canSend`, `getRampCapForMailbox`): it merges a stored override over `GUARDRAIL_SETTINGS_DEFAULTS` field by field, so **an (org, domain) pair with no override — every one of them today — resolves to exactly the same values SendGuardrail has always used, byte-for-byte.** The enforcement logic itself (rolling-window aggregation, rate-vs-threshold comparison, the ramp-up doubling formula) is completely unchanged; only the source of each input number moved from a direct constant import to this resolution. Verified by re-running every pre-existing `sendGuardrail.service.test.ts` case unmodified (only the added `GuardrailSettings.findOne` mock, always returning "no override," was needed) — all still pass with identical expected values.

Exposed at `GET /orgs/{orgId}/guardrail-settings` (one row per the org's own `sending_domains[]` entries, each showing the *effective* merged values plus `has_override`/`overridden_fields`), `GET/PUT/DELETE /orgs/{orgId}/guardrail-settings/{domain}` (`PUT` upserts only the fields given — the same partial-PATCH semantics as everywhere else in this codebase; `DELETE` clears the whole override, idempotently, reverting every field to default). Deliberately **not** scoped by purpose or mailbox: any configured domain can carry an override regardless of purpose, and the override applies uniformly to every mailbox on that domain — the state that must never pool across mailboxes (ramp elapsed time, pause status) already lives in `DomainSendEvent`/`DomainGuardrailState`, unaffected by any of this.

Two SendGuardrail-adjacent constants deliberately **not** touched: `emailPerformanceAnalysis.service.ts` still reads `THROTTLE_BOUNCE_RATE` directly (a diagnostic labeling heuristic, not the live send gate — out of scope for "SendGuardrail's ramp-up numbers and thresholds"), and `GUARDRAIL_RETRY_DELAY_MS` (the enrollment queue's retry backoff after a guardrail deferral) stays a global constant — it's neither a ramp-up number nor a threshold.

**Brand Voice guideline editing — found a bigger premise gap than expected.** `Organization.brand_voice_guidelines_id` (`ref: 'BrandVoiceGuidelines'`) has never actually been populated or read by anything — there was no `BrandVoiceGuidelines` model at all. The real guidelines lived in a single static `brand-voice-guidelines.md` file baked into the deployment image, read once and cached in memory by `brandVoice.service.ts`'s `getBrandVoiceGuidelines()`, global across every org (no per-org concept whatsoever). A static file can't be edited from a Settings screen — there's nothing to `PUT` to — and even editing it in place wouldn't durably work on App Runner's ephemeral containers (an edit vanishes on the next restart/deploy).

Fix: `BrandVoiceGuidelines` is now a real model (`{ text, version, updated_by }`), and `getBrandVoiceGuidelines()`/new `updateBrandVoiceGuidelines()` are DB-backed — but still a **single global document, not per-org**, matching the file's own pre-existing scope exactly. Wiring genuine per-org brand voice to `Organization.brand_voice_guidelines_id` would be a real product decision (does every org need its own brand voice, or is one shared voice intentional?) that this task didn't ask for and isn't attempted here — `brand_voice_guidelines_id` remains unused/dangling. `getBrandVoiceGuidelines()` falls back to the on-disk file, completely unchanged, until the first real edit — so nothing `generateEmailDraft` reads changes just because this moved off the filesystem. Exposed at `GET/PUT /brand-voice` — **deliberately not nested under `/orgs/{orgId}/...`** like every other Settings-screen endpoint: doing so would visually imply a per-org scope the underlying data doesn't have, and an org admin editing "their" brand voice would actually be silently rewriting every org's AI-generated drafts. `getBrandVoiceGuidelines()`'s caller (`emailGeneration.service.ts`) is now `await`ed — its only caller, so a one-line change; the in-memory cache is gone entirely (state lives in Mongo now, one more query per draft, consistent with everything else that function already looks up).

## Domain purpose model — `Organization.sending_domains[]`

✅ **Built.** Each org uses subdomains by purpose, not one flat domain per org: `mail.*` for marketing (MarkFlow's workflow engine sends), main domain for transactional (existing nodemailer system, untouched), `alert.`/`notify.*` for an org's own system-to-customer alerts (a possible future MarkFlow feature — not built, and not the same thing as MarkFlow's own internal ops notifications below). `sending_domains[]` is `{ domain, purpose: "marketing" | "transactional" | "alerts" }[]` (`src/constants/organization.ts`'s `SENDING_DOMAIN_PURPOSES`/`SendingDomainEntry`), not a flat string array. `DomainRouter`'s `resolveSendingRoute`/`routableDomainsForOrg` both take a `purpose` argument and only match a domain listed under that exact purpose — a marketing send can never resolve to a transactional/alerts domain even if the org also sends from it for another purpose. `enrollmentProcessor.ts`'s workflow-email sends always resolve with `purpose: 'marketing'`, since that's the only thing they ever are.

**Known real mapping, Aeon Synergies (DKIM confirmed on both):** `aeonsynergies.com` is `transactional`, `mail.aeonsynergies.com` is `marketing`. Record this in whichever org's `sending_domains[]` actually lists them (e.g. Aeon Miles's, if it sends via the Aeon Synergies domain) and in `DOMAIN_PROVIDER_MAP_JSON` (see `.env.example`) — the two configs are separate (org-permission vs. provider-ownership) and both need the real domains listed.

**Not the same system**: MarkFlow's own internal ops notifications (`ReviewTask` alerts, `SendGuardrail` pause notices) do **not** go through this model at all — see the next section. They use a single fixed deployment-level mailbox (`INTERNAL_NOTIFICATIONS_MAILBOX`), never `Organization.sending_domains[]`/`DomainRouter`, because they're MarkFlow's own alerts to its own ops team, not a per-org customer-facing send.

## Mailbox model — per-domain mailboxes, round-robin assignment, per-mailbox SendGuardrail

✅ **Built.** Each `sending_domains[]` entry can list several `mailboxes[]` (`{ address, display_name, status: "active" | "inactive" }` — `src/constants/organization.ts`'s `SenderMailboxEntry`), not just one implicit sender per domain. Left empty (the default — no migration needed for existing orgs), `resolveSendingRoute` falls back to `DOMAIN_PROVIDER_MAP_JSON`'s single deployment-level mailbox for that domain, exactly as before this existed.

**Assignment is explicit, not implicit — and happens once per enrollment, not once per send.** `mailboxAssignment.service.ts`'s `assignMailboxForDomain()` round-robins across a domain's `active` mailboxes by picking whichever has sent the fewest emails all-time (from `DomainSendEvent`, the same durable log SendGuardrail itself aggregates) — not an in-memory rotating cursor, which would race across `enrollmentProcessor`'s concurrent BullMQ workers and reset on every deploy. This converges on the same even rotation a cursor would, but the choice is always a read of real, auditable send history rather than hidden state. `inactive` mailboxes are never candidates but keep their own history intact for reactivation.

`domainRouter.service.ts`'s `assignMailboxesForDomains()` calls this once per distinct sending domain among a lead's own (post-A/B) steps, at enrollment creation (`enrollment.service.ts`'s `enrollSavedList`) — never per send. The result is snapshotted onto `Enrollment.assigned_mailboxes[]` and reused by every step that sends from that domain; `enrollmentProcessor.ts`'s `sendWorkflowEmail` looks it up and passes it into `resolveSendingRoute` as `options.assignedMailbox`, which then skips the round robin entirely. This is what stops a single lead's own sequence from visibly sending off a different named mailbox at every touch: the round robin still balances load across a domain's mailboxes, just at the point a new enrollment starts, not on every individual send within one already running. An enrollment created before this existed has no assignment for a given domain, so `resolveSendingRoute` falls back to resolving one on the spot for it — no migration needed.

**SendGuardrail tracks per mailbox, not per domain.** `DomainSendEvent`'s rolling-window aggregation and `DomainGuardrailState`'s pause state are both keyed on `(domain, mailbox)`, not `domain` alone — `getRampCapForMailbox()`, `canSend()`, `pauseDomain()`, and `resumeDomain()` all take an explicit `mailbox` argument now. This is the actual point: one mailbox tripping a hard-stop bounce/complaint rate pauses only that mailbox, never every other mailbox sharing its domain, and a newly added mailbox has no `DomainSendEvent` rows of its own yet — so it always starts its own ramp-up from `RAMP_UP_STARTING_DAILY_CAP`, regardless of how established the domain (or its other mailboxes) already are. `ReviewTask` (`kind: domain_guardrail`) now records `mailbox` alongside `domain` so a human reviewing a paused-mailbox task knows which one, not just which domain.

## Internal notifications (ReviewTask alerts, SendGuardrail pause notices) — built

✅ **Done.** `internalNotification.service.ts`'s `sendInternalNotification()` is the one place these go through — called from `sendGuardrail.service.ts`'s `pauseDomain`, `emailTemplateVersion.service.ts`'s `submitForReview`, and `emailOptimization.service.ts`'s `flagVersionDeliverabilityIssue`. It always sends via the `microsoft_graph` provider directly (`getEmailProvider('microsoft_graph')`), from the shared mailbox configured in `INTERNAL_NOTIFICATIONS_MAILBOX` (`notifications@aeonsynergies.com`) — never through `DomainRouter`/`resolveSendingRoute` and never gated by `SendGuardrail`'s `canSend`/`pauseDomain` logic. Deliberately its own code path, not a conditional branch inside the marketing send flow: these are low-volume internal alerts, not cold-outreach sends, and must never compete with or be throttled/paused by logic sized for marketing volume.

Recipients default to the mailbox itself (a shared inbox a team monitors together) — override with `INTERNAL_NOTIFICATIONS_RECIPIENTS` (comma-separated) to route to specific addresses instead. A failed send (missing config, mailbox not yet provisioned, transient Graph error) is logged and swallowed, never thrown — the triggering `ReviewTask`/`DomainGuardrailState` row is the real source of truth and is already persisted by the time the notification fires.

⚠️ **Manual step before relying on this in production**: confirm the `notifications@aeonsynergies.com` shared mailbox actually exists in the Aeon Synergies M365 tenant, and that the existing Graph app registration's Mail.Send permission covers it (if an Exchange Application Access Policy scopes that app to specific mailboxes, add this one). Not something this codebase can verify or provision itself — an ops task. Until confirmed, sends fail silently (logged, not thrown) rather than blocking the ReviewTask/pause they're attached to.

## Template review actions — approve/reject/resubmit, and listing open ReviewTasks — built

✅ **Done.** Until this work, `PENDING_APPROVAL` `EmailTemplateVersion`s had no HTTP-reachable way to be acted on at all — `approveVersion`/`rejectVersion`/`resubmitVersion` existed and were fully tested at the service layer, but nothing routed to them, and the frontend's Template Review queue (`aeon-markflow`) was read-only for exactly that reason. Added:

- `POST /orgs/{orgId}/email-templates/{templateId}/versions/{versionId}/approve` — `PENDING_APPROVAL` → `APPROVED`, sets `EmailTemplate.current_version_id`, closes the open `ReviewTask` (`status: APPROVED`). Gated `TEMPLATE_APPROVER_ROLES` (see the RBAC correction above).
- `.../reject` — `PENDING_APPROVAL` → `REJECTED`, requires a non-blank `reason` in the body (400 without one), closes the `ReviewTask` with that reason recorded. Same gate.
- `.../resubmit` — chains `resubmitVersion` (`REJECTED` → `RESUBMITTED`, applying optional edits) with `submitForReview` (→ `PENDING_APPROVAL`, opens a fresh `ReviewTask`) into one call, since `resubmitVersion` alone leaves nothing for a reviewer to act on. Gated `WORKFLOW_ACCESS_ROLES`, not `TEMPLATE_APPROVER_ROLES` — resubmitting is the original author's move, not a reviewer's.
- `GET /orgs/{orgId}/review-tasks` (new `reviewTask.routes.ts`/`.service.ts`) — lists a org's `ReviewTask`s, defaulting to `status=OPEN`, with optional `status`/`kind` filters. Gated `WORKFLOW_ACCESS_ROLES`. This is what lets a Review queue UI list what's actually open directly, instead of inferring "pending" from `EmailTemplateVersion.status` alone.

**Deliberate path deviation**: nested all four under the existing `/orgs/{orgId}/email-templates/{templateId}/versions/{versionId}/...` sub-resource (reusing `resolveVersionForOrg`'s existing not-found-not-forbidden masking) rather than the unscoped `/email-template-versions/:id/...` shape floated when this was requested — every other resource in this API is org-scoped in its path, and an unscoped version route would be the only exception.

**Was open, now partly closed**: `submitForReview`'s *other* call site — the original `DRAFT` → `PENDING_APPROVAL` submission — still has no HTTP route, but `createAiDraftVersion` itself now does (see "BD-Marketing role and on-demand AI drafts" below). So a caller can now create an AI `DRAFT` version over HTTP, but still cannot submit it for review over HTTP — it stays `DRAFT` until either a human uses whatever non-HTTP path exists today, or a future task adds that route too.

## BD-Marketing role and on-demand AI drafts — built

✅ **Done.** Three related additions:

1. **New `BD_MARKETING` role** (`src/constants/access.ts`'s `ROLES`). It replaces `BD_SALES` in `TEMPLATE_APPROVER_ROLES` (now `SUPER_ADMIN`/`ADMIN`/`BD_ADMIN`/`BD_MANAGER`/`BD_MARKETING` — `BD_ADMIN` was also added) and, since `sendGuardrail.service.ts`'s `resumeDomain` imports `TEMPLATE_APPROVER_ROLES` directly rather than duplicating it, its "human signed off" gate for resuming a paused mailbox picked up the identical change automatically — no separate edit needed there, just confirmed by reading it. `BD_SALES` is unaffected everywhere else (it keeps its full `WORKFLOW_ACCESS_ROLES` membership — building/running workflows — it just no longer approves/rejects template *content* specifically).

   `BD_MARKETING` was also added to `WORKFLOW_ACCESS_ROLES` — **not explicitly asked for, but required**: the frontend nav shows BD-Marketing the Workflows/Template Review/Template Library links, and every one of those pages' own endpoints (`workflowTemplate.routes`, `emailTemplate.routes`' listing/usages/versions/resubmit, `reviewTask.routes`) is gated on this exact role list; leaving `BD_MARKETING` out would mean showing nav links that 403, which this codebase's own established convention (see the frontend `aeon-markflow` CLAUDE.md) says never to do. **Known, accepted imprecision this carries over**: `WORKFLOW_ACCESS_ROLES` also gates `savedList.routes`' bulk lead-list/enrollment endpoints, so `BD_MARKETING` is technically able to call those directly even though the RBAC table's intent is "no Lead access — that's sales' job." There is no existing narrower role set that separates "template/workflow access" from "lead bulk-action access," and building one is out of scope here. The frontend simply never shows the Leads nav link, the Recycled/Win-back filter, or the bulk-select UI to BD-Marketing — same shown-vs-403 discipline as every other role-based hide, just enforced entirely at the nav layer rather than the API layer for this one role. If this gap ever needs closing, it means splitting `WORKFLOW_ACCESS_ROLES` into two role sets, which touches every route listed above.

2. **`POST /orgs/{orgId}/email-templates/{templateId}/versions/ai-draft`** — wraps `createAiDraftVersion` (previously only reachable from the internal Phase 6 diagnosis job) in an HTTP route. Body: `persona`/`workflow_position` (both optional, folded into the generation instructions — the `EmailTemplate`'s own stored `persona`/`workflow_position` already drive reference-example lookup inside `generateEmailDraft` regardless, so these aren't the sole source of truth for either) and `brief` (required — the actual content ask; 400 without one). Gated `TEMPLATE_APPROVER_ROLES`, deliberately narrower than `WORKFLOW_ACCESS_ROLES` — the same people who'd ultimately review the draft are the ones trusted to spend a generation call producing it. Always produces a `DRAFT`, never auto-submits it for review — same human-in-the-loop gate as every other draft, AI-generated or not. See the still-open gap noted above: there's now an easier way to reach a `DRAFT` with no HTTP path to move it out of `DRAFT`.

3. **`RECYCLED_SEGMENT_ROLES`** also gets `BD_ADMIN` and `BD_MARKETING` added (`BD_SALES` stays — see the RBAC table above for why this is additive, not a swap like `TEMPLATE_APPROVER_ROLES`).

## DISCOVERY_RETRY status, the Lost+Recycle receiving endpoint, and its daily graduation sweep — built

✅ **Done.** This is the one piece of the Discovery handoff timing design (below) that's real MarkFlow-side work, buildable independent of Onboard — see that section for the full design context.

**Premise correction, flagged rather than silently worked around**: the request that produced this assumed a "Lost+Recycle" receiving mechanism already existed for `RECLAIMED` (a route, a service function — *something* to reuse/extend for `DISCOVERY_RETRY`). It didn't. Before this change, `RECLAIMED`, `lost_reason`, `lost_stage`, `recycled_from_deal_id`, and `eligible_for_reengagement_at` existed only as `Lead` schema fields and the read-side `GET /orgs/{orgId}/leads?segment=recycled` filter — nothing anywhere ever *wrote* them. `leadRecycle.service.ts`'s `recycleLead()` is the actual first implementation of the Lost+Recycle event's receiving side, handling both tiers at once (not just `DISCOVERY_RETRY`), since there was nothing narrower to build against.

- **`DISCOVERY_RETRY`** added to `LEAD_STATUSES`. `DISCOVERY_RETRY_LOST_REASONS` (`src/constants/lead.ts`) — `no_show`/`cancelled_discovery` — are the specific `lost_reason` values `recycleLead()` recognizes as "routes to `DISCOVERY_RETRY`"; `lost_reason` itself stays free text everywhere else (same convention as `persona`/`workflow_position`/`intended_workflow_type`), any other value routes to `RECLAIMED`.
- **`POST /orgs/{orgId}/leads/{leadId}/recycle`** (`lead.routes.ts`) — the event's receiving endpoint. Body: `deal_id`/`lost_reason`/`lost_stage` (all required, 400 without one) and optional `eligible_for_reengagement_at`. Gated `WORKFLOW_ACCESS_ROLES`. **This route *is* the "internal/test trigger"** the request asked to reuse — since none existed, this is deliberately built as a normal authenticated org-scoped route (same shape as every other mutating endpoint here) rather than inventing service-to-service auth for a caller (Onboard) that doesn't exist yet; that's a real gap to close whenever Onboard's own build actually reaches this integration, not attempted here.
- **`Lead.discovery_retry_started_at`** (new field) — set when `recycleLead()` transitions a Lead into `DISCOVERY_RETRY`, cleared when it leaves that status. Exists specifically so the daily graduation sweep has something precise to check against — `updatedAt` would be wrong here, since it changes on any field edit, not just a status change.
- **`graduateStaleDiscoveryRetryLeads()`** (`leadRecycle.service.ts`) + `discoveryRetryQueue.ts`/`discoveryRetryWorker.ts` (registered in `worker.ts`, same `upsertJobScheduler` pattern as every other repeatable job here) — a daily sweep that flips any Lead sitting in `DISCOVERY_RETRY` past `DISCOVERY_RETRY_GRADUATION_DAYS` (30, a proposed default) to `RECLAIMED`. A pure status flip; `lost_reason`/`lost_stage` stay exactly as recorded.
- **`GET /orgs/{orgId}/leads?segment=recycled`** now matches `status: { $in: ['RECLAIMED', 'DISCOVERY_RETRY'] }`, not just `RECLAIMED` — both tiers share the one Recycled/Win-back segment (see the frontend `aeon-markflow` CLAUDE.md for how the UI tells them apart within it).
- **`EmailTemplate.intended_workflow_type`** — `"discovery_retry"` is now a documented example category (`EmailTemplate.model.ts`'s own comment) for DISCOVERY_RETRY's future reschedule-focused template. No code change was possible or needed beyond that comment: this field has no backing enum anywhere (see "EmailTemplate browsing, filtering, and usage lookup" above) — any string was already a "valid" value before this change, including this one. Building the actual template content is separate, later work.

## JWT shared-secret contract — corrected: MarkFlow's shape is the standard

Onboard will be **rebuilt fresh**, not cloned from the old `cooterlabs/aeon-onboard-backend` codebase — so that codebase's existing JWT shape (`{ id, user_type: "Admin"|"Client", iat }`) is irrelevant and does not need to be matched. MarkFlow's already-implemented shape — `{ sub, email }`, verified in `auth.middleware.ts`'s `requireAuth` — is the real, working contract. **When Onboard's fresh build happens, its auth must be built to issue and verify `{ sub, email }` JWTs, signed with the same `JWT_SECRET` value MarkFlow uses** — not the reverse. `JWT_SECRET` itself is a freshly generated random value (not fetched from the old Vercel deployment), stored identically in both apps' secrets once Onboard exists.

`POST /orgs/{orgId}/leads/{leadId}/recycle` (the Onboard → MarkFlow Lost+Recycle receiver, PR #41 — see "DISCOVERY_RETRY status..." above) is gated by `requireRole(WORKFLOW_ACCESS_ROLES)` — a normal human-user JWT with an org-scoped role. This works for testing/manual calls now, but **won't work when Onboard's backend actually calls this as a server-to-server webhook** once its build resumes — a server isn't a user with an org-scoped role. Needs a service-to-service auth mechanism (a dedicated internal API key/shared secret distinct from user JWTs, or a "system" identity) before Onboard's build can actually wire this up. Flagged now so it isn't rediscovered painfully later.

## Planned, not yet built: BD-Sales narrowing + the rest of Discovery handoff timing

⏳ **Decided, not started** — this is real planning, kept here so it isn't lost, but no code in this repo reflects it yet (`DISCOVERY_RETRY` itself excepted — see above). Confirmed out of scope until Onboard's own build resumes, since most of it lives on Onboard's side.

- **BD-Sales (narrowed, spans both apps)**: MarkFlow — calling, discovery/onboarding meeting scheduling, entering pricing after discovery (likely moves to Onboard entirely once Onboard's build resumes). Onboard — negotiation, deal actions, pricing continuation. Not yet reflected in `WORKFLOW_ACCESS_ROLES`/`TEMPLATE_APPROVER_ROLES`/anywhere else in this codebase — BD-Sales still has its full pre-narrowing access today.
- **Discovery handoff timing, no-show/retry handling, and pricing location — finalized design, mostly not built**:
  - **Handoff timing**: fires at **Discovery Meeting Scheduled**, not at the "Interested" outcome (the intro section above already reflects this as the decided design). Deal created in Onboard the moment scheduling happens; Discovery itself becomes Onboard's domain, not MarkFlow's. Not built — this is Onboard's own side of the handoff.
  - **No-show / cancelled → `DISCOVERY_RETRY`, `DISCOVERY_RETRY` → `RECLAIMED` after 30 days**: ✅ built — see above.
  - **Reschedule (before any no-show)**: stays in Onboard — just a status/time update via the Aeon Scheduler webhook, no cross-app event. Not MarkFlow's side to build.
  - **`DISCOVERY_RETRY` successfully reschedules**: the handoff mechanism fires again normally, a new Deal created in Onboard. Onboard's side; not built.
  - **"Follow-up Required"**: stays in Onboard, same treatment as reschedule. Not MarkFlow's side to build.
  - **"Not Interested" (Lost after the call)**: Lost+Recycle mechanism, same as any other post-call loss — reaches `recycleLead()` the same way `no_show`/`cancelled_discovery` do, just with a different `lost_reason`, so this end is already handled; what's not built is Onboard actually calling it.
  - **Pricing entry**: happens directly in Onboard once the Deal exists there — no MarkFlow pricing UI or cross-app sync channel. Not MarkFlow's side to build.

## Go-live status: send-time/content-pattern optimization (Phase 7)

✅ **Built.** `sendTimePerformance.service.ts`'s `computeSendTimeRollups()` recomputes every `SendTimePerformance` bucket on a rolling basis (last `SEND_TIME_ROLLUP_LOOKBACK_DAYS`, not all-time) from `EmailEngagement` rows — each send is bucketed by the **recipient's own local** day-of-week/hour (via `Contact.timezone`, falling back to UTC when unknown — never the server's timezone; see `src/utils/timezone.ts`). Target metric is reply rate / meeting-booked, same as everywhere else — **never open rate**. `sendTimeOptimization.service.ts`'s `runSendTimeOptimization()` (scheduled daily by `sendTimePerformanceQueue.ts`/`Worker.ts`, also callable on demand) then evaluates every (org, workflow_type, persona) group belonging to an org whose `send_time_strategy` isn't `"manual"`:

- **`ai_suggested`**: a better-performing (day/hour/timezone, content) combination creates a `SendTimeRecommendation` in `OPEN` status plus a `ReviewTask` (`kind: 'send_time_recommendation'`) — the same `ReviewTask`/human-approval gate as everywhere else in MarkFlow. `approveSendTimeRecommendation`/`rejectSendTimeRecommendation` (role-gated, same bar as approving an `EmailTemplateVersion`) decide it; approving supersedes whichever recommendation was previously active for that group.
- **`ai_automatic`**: the same discovery, but the recommendation is created already `APPROVED` — no `ReviewTask`, no per-send approval, per the spec ("schedules within a validated window without per-send approval"). Still sends an internal notification either way, so a human always knows what changed even when nothing was asked of them — same precedent as SendGuardrail's autonomous domain-pause action.
- Both paths require the same minimum-sample-size discipline as SendGuardrail/Phase 6 (see table below) before trusting any bucket, and require several qualifying buckets before picking a "best" one — comparing the only bucket ever tried against nothing isn't a comparison.

**Enforcement, in `enrollmentProcessor.ts`'s `sendWorkflowEmail`**: when an enrollment's snapshotted `send_time_strategy` isn't `manual`, it looks up the active (`APPROVED`) recommendation for its (org, workflow_type, persona) group. If the recipient is in-window (their local day/hour matches, **and** their own resolved timezone matches the recommendation's `timezone_bucket` exactly — see known gap below), it sends now; otherwise it computes the delay to the next matching window (`nextOccurrenceInTimezone`) and re-enqueues via `enqueueSendTimeRetryJob` rather than sending. **SendGuardrail always has the final word**: this send-time check runs *before* `canSend()`, never instead of it — a slot send-time optimization considers optimal that SendGuardrail would still throttle/pause gets deferred by SendGuardrail's own retry delay, not overridden or re-picked by send-time logic. No active recommendation yet (or strategy is `manual`) → sends immediately, exactly like before Phase 7 existed.

⚠️ **Known gap, not built**: a `SendTimeRecommendation` is computed for one specific `timezone_bucket`. A recipient whose own resolved timezone doesn't match that bucket exactly falls straight through to sending immediately (manual-equivalent) rather than being evaluated against a mismatched clock. Multi-timezone recommendations (picking the right bucket per recipient timezone, not just one bucket per group) would need real send volume across timezones to be worth building — revisit once that data exists.

**Proposed numeric defaults — not yet reviewed, all in `src/constants/sendTimeOptimization.ts`:**

| Constant | Default | What it gates |
|---|---|---|
| `MIN_SAMPLE_SIZE_FOR_SEND_TIME_BUCKET` | 30 sends | Below this, a single bucket's reply/meeting rate isn't trusted at all |
| `MIN_CANDIDATE_BUCKETS_BEFORE_RECOMMENDING` | 3 buckets | Minimum qualifying buckets for the same (org, workflow_type, persona) before picking a "best" one |
| `SEND_TIME_IMPROVEMENT_MARGIN` | 10% relative | How much better a new bucket's reply rate must be than the current approved one before proposing a change — avoids flapping on ordinary noise |
| `SEND_TIME_ROLLUP_LOOKBACK_DAYS` | 90 days | How far back the rolling rollup looks each time it recomputes |
| `SEND_TIME_ROLLUP_INTERVAL_MS` | 24 hours | How often the rollup + recommendation cycle re-runs — matches Phase 6's cadence |

## Go-live status: multi-org rollout — image policy + cross-org insights (Phase 8)

✅ **Built.** Two independent pieces:

**Image-placeholder policy.** `EmailTemplateVersion.image_policy`/`image_blocks[]` existed since Phase 3 but nothing read them at send time until now. `imagePolicy.service.ts`'s `resolveImageRenderDecision()` is called from `enrollmentProcessor.ts`'s `sendWorkflowEmail`, right before link-tracking rewrite:
- `always`/`never` are unconditional.
- `auto` **always strips on the first-touch step** (`workflow_step_index === 0`), regardless of the recipient — a cold first contact is the highest-risk moment for image-heavy content to read as spam. On any later touch, it renders for a `corporate` recipient and strips for a `consumer` one.

Provider classification (`providerCategory.service.ts`'s `classifyDomain()`) checks a hardcoded list of well-known free webmail brands first (no DNS needed), then a long-lived `RecipientProviderCategory` cache, then falls back to an MX lookup (Node's built-in `dns/promises`, no new dependency) — cached afterward. `renderOrStripImageBlocks()` (cheerio, matching `linkTracking.service.ts`'s own HTML-manipulation convention) then removes or fills in the `<img data-block-id="...">` elements that match `image_blocks` entries; anything else in the HTML (like the open-tracking pixel, inserted later) is untouched either way.

⚠️ **This whole render/strip split (consumer→strip, corporate→render, on non-first-touch) is a proposed default, not a measured fit** — flagged for review same as every other unreviewed heuristic in this codebase. The MX lookup itself mostly just confirms real mail infrastructure exists (and records `mx_hosts` for audit) rather than driving today's binary classification — see `src/constants/providerCategory.ts`'s own comment on why a more refined MX-pattern-based split isn't attempted without real deliverability data to calibrate it against.

**Cross-org insight sharing.** `crossOrgInsight.service.ts`'s `computeCrossOrgInsights()` (scheduled weekly by `crossOrgInsightQueue.ts`/`Worker.ts`, also callable on demand) scans **every org's** `WorkflowTemplate` (sequence_shape: the ordered step-kind list; step_count: how many steps) and qualifying `SendTimePerformance` buckets (send_time_window, Phase 7) and groups them into abstracted patterns. The abstraction is structural, not a policy toggle: a `CrossOrgInsight` document is only ever created once a pattern is independently observed across at least `MIN_ORGS_FOR_INSIGHT` **distinct** orgs — so by construction, no insight can ever trace back to fewer orgs than that, and it never stores one org's own content or org-specific numbers, only pooled ones. `send_time_window`'s `avg_reply_rate`/`avg_meeting_rate` are sample-size-weighted across every qualifying org, never a flat per-org average.

Two read routes, both new (`crossOrgInsight.routes.ts`, mounted globally — not org-scoped, since the data isn't org-specific):
- `GET /cross-org-insights` — any workflow-access role. Returns only a coarse `confidence` label (`emerging`/`established`); deliberately omits `org_count`/`sample_size`/`avg_*_rate` so even this generic view can't be used to infer exactly how many orgs or sends back a pattern.
- `GET /cross-org-insights/raw` — gated by a new `ADMIN_ONLY_ROLES` (`SUPER_ADMIN`/`ADMIN`) in `src/constants/access.ts`, the first role array in this codebase this restrictive. Returns every field, including the real pooled numbers.

This is the "surfaced in the workflow builder" backend half — the actual visual workflow builder is frontend work in the separate `aeon-markflow` repo, same split as Phase 4's React Flow canvas.

**Proposed numeric defaults — not yet reviewed, all in `src/constants/crossOrgInsight.ts` / `src/constants/providerCategory.ts`:**

| Constant | Default | What it gates |
|---|---|---|
| `MIN_ORGS_FOR_INSIGHT` | 3 orgs | The actual abstraction mechanism — no insight can exist below this many distinct orgs |
| `MIN_SAMPLE_SIZE_FOR_INSIGHT` | 90 sends | `send_time_window` insights only (not sequence_shape/step_count, which use org_count alone) |
| `MIN_ORG_BUCKET_SAMPLE_SIZE` | 30 sends | A `send_time_window` insight only pulls from an org's own buckets that already clear this floor |
| `ESTABLISHED_SAMPLE_SIZE_THRESHOLD` | 300 | Sample size at/above this is labeled "established" in the generic view; below it, "emerging" |
| `CROSS_ORG_INSIGHT_INTERVAL_MS` | 7 days | How often the cross-org rollup recomputes — weekly, not daily, since these patterns move far slower than one org's own tuning |
| `PROVIDER_CATEGORY_CACHE_TTL_MS` | 30 days | How long a domain's MX-derived classification is trusted before re-checking |

## Yahoo/AOL CFL — deprioritized, not abandoned

DKIM setup continues regardless (valuable for deliverability to every provider). The Sender Hub CFL *signup* step specifically is deprioritized: it only yields complaint signal for Yahoo/AOL-hosted recipients, and very few leads use those addresses given the ICP. Revisit if the lead mix ever shifts toward more consumer webmail.



## The three things that must never be violated

1. **"Response rate" means reply rate / meeting-booked, never open rate**, anywhere in analytics or optimization logic. Opens are unreliable (Apple MPP, Gmail proxy caching).
2. **Human-in-the-loop gates are real gates**: AI-generated template content and AI-suggested workflow/optimization changes sit in `DRAFT`/`PENDING_APPROVAL` until a human with the right role approves — never auto-applied. Exception: safety/compliance mechanisms, not content/strategy judgment calls, can act autonomously — sending guardrails (domain warmup/throttling) and AI-classified unsubscribe-request handling (contact suppression + enrollment exit) both do, and both still leave a `ReviewTask` + internal notification behind so a human sees it happened.
3. **A `WorkflowStep` pins to a specific `email_template_version_id`, never "latest."** Editing a template must never silently change a sequence already enrolling leads.

## RBAC, condensed

| Role | MarkFlow access |
|---|---|
| Super Admin / Admin | Full, all orgs |
| BD Admin | Full |
| BD Manager | Full lead + workflow access |
| BD-Lead Gen | Upload/monitor leads only — no workflow, no email/call access |
| BD-Sales | Full workflow access (build, run) |
| BD-Marketing | Template/workflow access (Workflows, Template Review, Template Library) — no Lead access; leads are sales' pipeline, not marketing's |

Recycled/Win-back lead segment (`RECYCLED_SEGMENT_ROLES`) visible to: BD-Sales, BD-Manager, BD-Marketing, BD Admin, Admin, Super Admin. Updated when BD-Marketing was introduced: win-back re-engagement is a workflow/email concern (BD-Marketing's job to run), but once a recycled lead responds it needs a discovery call booked — BD-Sales' job again — so this wasn't a swap like `TEMPLATE_APPROVER_ROLES` was; both need visibility. BD Admin was added for the same hierarchy-consistency reason as its `TEMPLATE_APPROVER_ROLES` inclusion. This set is now identical to `WORKFLOW_ACCESS_ROLES` — no longer the deliberately-narrower-by-excluding-BD-Admin subset it used to be.

Raw cross-org insight data (`GET /cross-org-insights/raw`, Phase 8) visible to: Super Admin, Admin only — see `ADMIN_ONLY_ROLES`. Everyone with workflow access still sees the generic, coarse-labeled recommendations at `GET /cross-org-insights`.

Org-level configuration — `Organization` settings, `UserAccessGrant` management, `GuardrailSettings`, Brand Voice guidelines — visible/editable to: Super Admin, Admin only (`ADMIN_ONLY_ROLES`, same set as raw cross-org insight data). This is a new rule as of the Settings screen backend, not something CLAUDE.md documented before it: only Admin/Super Admin may grant or edit `UserAccessGrant`s at all, which is stricter than `WORKFLOW_ACCESS_ROLES` (BD Admin/BD Manager/BD Sales/BD-Marketing included there have no access to any of this). See "Settings screen backend" below.

Who may approve/reject an `EmailTemplateVersion` — `TEMPLATE_APPROVER_ROLES` (`src/constants/emailTemplate.ts`) — is **Super Admin, Admin, BD Admin, BD Manager, BD-Marketing** (updated when the BD-Marketing role was introduced — see "BD-Marketing role" below; previously Super Admin/Admin/BD Manager/BD-Sales, which itself corrected an even earlier guess of "BD Admin/BD Manager" — this table row keeps drifting because it isn't the source of truth, `src/constants/emailTemplate.ts` is; check the constant directly rather than trusting this line to be current).

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

## Standing instruction: flag write/action-path gaps explicitly, don't let them surface later

Recurring pattern across several PRs: schema and read-only paths ship, the actual write/action mechanism lags silently until something else needs it and surfaces the gap (Contact's missing name/company, no approve/reject routes for template review, no on-demand-draft route, no recycle-receiving mechanism at all until PR #41). Going forward: when shipping schema or a read-only endpoint for a feature that's clearly going to need a write/action counterpart, say explicitly whether that counterpart exists, is being deferred deliberately, or isn't in scope for this PR — rather than leaving it to be discovered when something else breaks against the gap.

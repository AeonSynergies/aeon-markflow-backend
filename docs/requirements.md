# Aeon Onboard — Sales & Marketing Platform: Requirements & Architecture

*Now incorporating your Deal Stage Movement Logic and RBAC source-of-truth documents. These are precise, deterministic business rules — I've folded them in as authoritative and flagged where my earlier, more generic assumptions need correcting. Nothing previously confirmed as built has been removed.*

---

## 1. Confirmed stack

| Layer | Stack |
|---|---|
| Frontend | React 19 + TypeScript + Vite, Tailwind v4, shadcn/Radix UI, TanStack Query + Redux Toolkit + Zustand, react-hook-form + zod, TipTap, Stripe React SDK, `react-pdf`/`@react-pdf-viewer`, `xlsx` |
| Backend | Node.js + Express 5 + TypeScript, MongoDB via Mongoose, JWT + bcrypt, Swagger docs, Socket.io, AWS S3 + Cloudinary, Puppeteer, Handlebars, nodemailer |
| Payments | Stripe + a scaffolded QuickBooks service (relationship still unconfirmed — see §13) |
| Domain | Aeon Synergies, selling into last-mile delivery/DSP operators (drivers, vans, stations, USDOT) |

---

## 2. CRM Data Model

### Corrected lifecycle (per your Deal Stage document — supersedes my earlier generic pipeline)

```
Lead  →  Discovery Meeting Scheduled (via Aeon Scheduler)
      →  Lead.status becomes PROSPECT, Deal record created, Deal.stage = Discovery
      →  Discovery
      →  Price Approval
      →  Draft Sent
      →  Negotiation & Correction  (optional loop back to Price Approval on pricing change)
      →  Deal Won  →  Client
```
Lost is possible from: **Discovery, Price Approval, Negotiation & Correction.**

This confirms and replaces my earlier "New → Qualified → Meeting Scheduled → Proposal Sent → Contract Sent → Negotiation → Closed Won/Lost" guess — your actual stage names are **Discovery, Price Approval, Draft Sent, Negotiation & Correction, Deal Won**, with **Lost** as a terminal state reachable from three of them, not a pipeline stage of its own.

### Stage vs. Status (your distinction, now the standard for this doc)
- **Stage** = major milestone (Discovery, Price Approval, Draft Sent, Negotiation & Correction, Deal Won)
- **Status** = operational state within a stage (e.g., within Price Approval: Pending Approval / Approved / Rejected / Resubmitted; within Draft Sent: Proposal Sent / Viewed / Awaiting Signature / Signed / Payment Failed / Correction Requested / Resent Corrected / Expired)

### Models already built (unchanged from last version — repo-confirmed)
Lead (`lead_model.ts`), Deal (`deal_model.ts` — commit history shows `deal_logics_completed_in_discovery_and_price_approval_section`, so **much of §3 below may already be implemented** — see the open question in §13), Client, Agreement, Service/Package, Subscription, Activity, Template, Payment.

---

## 3. Deal Stage Movement Logic (from your source-of-truth document)

### 3.1 Lead → Deal conversion
Trigger: **Discovery Meeting scheduled** (via Aeon Scheduler integration — see §9). On scheduling:
1. `Lead.status` → `PROSPECT`
2. Deal record created, `Deal.stage = Discovery`
3. Meeting synced from Aeon Scheduler
4. Discovery-prep task created
5. Calendar event created
6. Activity timeline updated

**This is the precise exit condition the marketing/engagement Workflow Engine (§8) should watch for** — see §7 for how these two systems connect.

### 3.2 Discovery stage
- **Not allowed**: pricing, discounts, revenue values, contract generation, service commitment
- **Editable**: prospect info, notes, meeting logs, interested services/products, discovery outcomes, client expectations
- **Outcomes**: Interested → Price Approval · Follow-up Required → stays in Discovery · Not Interested → Lost
- **Auto-created**: follow-up/reminder/callback/meeting tasks

### 3.3 Discovery → Price Approval: the Pricing Configuration Modal
Triggered by "Move to Price Approval," this modal is **mandatory** before the stage can advance.

| Field | Behavior |
|---|---|
| Services | Multi-select |
| Packages | Dynamically loaded based on service selection |
| Base Price | Auto-populated from Services & Products catalog |
| Discount Type | Percentage or Fixed Amount |
| Discount Value | Editable |
| Final Price | Auto-calculated |
| Service Start Date | Required |

Selecting a service auto-fetches package options, base pricing, related onboarding team, SOW/SLA structure, and service/product category. Cannot continue without a service/product selected, a start date, and complete pricing.

On "Submit for Approval": saves the pricing config, creates a **pricing version**, creates an approval request + task, notifies the approver, moves `Deal.stage → Price Approval`, `status → Pending Approval`, logs the audit trail.

### 3.4 Price Approval stage
Statuses: **Pending Approval, Approved, Rejected, Resubmitted.**

Approver reviews services, products, packages, discounts, final pricing, start date.

**Approval thresholds** (from RBAC doc, §4 below — repeated here since it governs this stage):
| Discount range | Approver |
|---|---|
| 0–10% | BD Manager |
| 10–20% | Head of BD |
| >20% | Admin / Finance Head |

**Rejection flow**: stays in Price Approval, everything editable, resubmit.

**Approval expiry** (recommendation in the source doc, not yet necessarily built): if not acted on within a configured SLA → escalate to manager, create overdue task, send reminders, highlight on dashboard.

### 3.5 Price Approval → Draft Sent: automated contract logic
Trigger: approver clicks **Approve Pricing**. Contract generation is **fully automated — no manual template selection.**

**Aeon Sign is the source of truth** for templates, contract editing, delivery, and signature tracking. **Aeon Onboard only sends the payload and tracks status** — this is an important scope boundary for the Aeon Sign integration (§10): don't build template management here, just a payload-sender + status-tracker.

**Automated template selection**:
| Deal composition | Generates |
|---|---|
| Service only | MSA + Service SOW & SLA |
| Product only | MSA + Product SOW & SLA |
| Service + Product | MSA + Combined SOW & SLA |

**MSA** (Master Service Agreement): legal terms, policies, governance, confidentiality, termination. Sent **only the first time**, one-time signature, no pricing/service details, not regenerated unless legally required.

**SOW & SLA**: SOW = services/products, pricing, deliverables, resource allocation. SLA = working hours, support terms, holidays, obligations. Regenerated on: first signup, new service added, product added, service/product reactivated. **Acknowledgement only** (checkbox), not a signature, unlike the MSA.

### 3.6 Draft Sent stage
Statuses: **Proposal Sent, Viewed, Awaiting Signature, Signed, Payment Failed, Correction Requested, Resent Corrected**, plus **Expired** (see below).

- **Contract expiry**: configurable validity period (e.g. 15 days) → status `Expired` → reminder task, notify sales owner, dashboard highlight, resend required
- **Auto reminders**: Day 2 / Day 5 / Day 10 escalation, via email, in-app notification, and/or task reminder — this reminder cadence is a good pattern to reuse for the marketing Workflow Engine's own follow-up timing (§8)

**Client contract flow**: view agreement → sign MSA → acknowledge SOW & SLA → add payment method → complete payment.

### 3.7 Payment logic — gate before Deal Won
**Mandatory, all three**: MSA signed + SOW & SLA acknowledged + payment successful. If payment fails, **remain in Draft Sent** with status `Payment Failed` — never move to Deal Won on a failed payment.

### 3.8 Draft Sent → Deal Won
Trigger: signed MSA + acknowledged SOW & SLA + successful payment, all three. System then:
1. Converts Prospect → Client
2. Creates Client profile
3. Creates Billing profile
4. Creates Stripe customer
5. Archives agreement references
6. Creates onboarding profile + onboarding tasks
7. Redirects client to **Aeon Scheduler** for onboarding scheduling

### 3.9 Onboarding trigger logic
Immediately after successful payment, client is redirected to Aeon Scheduler with two options:
- Schedule onboarding immediately, or
- Schedule later → system creates a sales follow-up task + onboarding-pending task + reminder notification

### 3.10 Negotiation & Correction stage
Allowed changes: pricing, discounts, services, products, service start date. Contract corrections happen in Aeon Sign; Aeon Onboard only tracks workflow status, contract status, correction requests.

**Critical rule — pricing change always requires reapproval**: any pricing change → must return to Price Approval, trigger reapproval, create a new pricing version, log audit trail. No exceptions.

**Pricing version history** (mandatory): old/new pricing, old/new discount, changed services/products, changed by, changed date, approval/rejection history.

### 3.11 Lost & Reopen logic
Lost is reachable from Discovery, Price Approval, or Negotiation & Correction. Lost reasons (dropdown): Budget, No response, Competitor, Internal decision, Timing, Invalid lead, Other.

**Reopen rule (important, easy to get wrong)**: a reopened Lost deal does **not** return to its previous stage — it moves back to **Lead**, because discovery must happen again and context may have changed. Open question: what `Lead.status` value should a reopened deal reset to? The current enum (`NEW-COLD`, `NEW-INBOUND`, `CONTACTED`, etc.) doesn't have an obvious "reopened" value — worth deciding whether to add one or reuse an existing status.

### 3.12 Deal locking, post-Won
After Deal Won: pricing, services, products, and discounts are locked. Changes only through a Client request workflow, Finance adjustment workflow, or Service modification flow — not direct edits.

### 3.13 Task automation matrix (by stage)
| Stage | Auto-created tasks |
|---|---|
| Discovery | Follow-up, callback reminders, discovery tasks |
| Price Approval | Approval task, discount review task, escalation reminders |
| Draft Sent | Signature reminders, payment reminders, contract follow-up tasks |
| Negotiation | Reapproval tasks, correction tasks, contract resend tasks |
| Deal Won | Onboarding tasks, scheduler tasks, internal handoff tasks |

### 3.14 Revenue forecasting rule
Pipeline revenue includes **only** Approved-Price-Approval and Draft Sent deals. **Discovery-stage revenue is excluded** — don't count unpriced/unapproved deals in forecasts.

### 3.15 Edge cases (explicitly called out in the source doc)
| Case | Handling |
|---|---|
| Payment failed after signature | Stay in Draft Sent, status Payment Failed |
| Client signs but doesn't schedule onboarding | Deal stays Won, onboarding status Pending |
| Approval SLA expired | Escalate, create overdue task, send reminders |
| Contract expired | Status Expired, requires resend |
| Service added after Client created | New SOW & SLA generated; MSA **not** regenerated |

---

## 4. RBAC & Access Control (from your source-of-truth document)

### Model
A **hybrid** system: role-based permissions + permission overrides + scope-based visibility. Access types per module action: View, Create, Edit, Delete, Approve, Assign, Export, Override.

### Role hierarchy
```
Super Admin → Admin → BD Admin → BD Manager → {Lead Gen Team, Sales Team, Contract Handler}
Finance Head → Finance Executive
Onboarding Manager → Onboarding Executive
Operations Manager/CSM → Operations Executive
Support Manager → Support Executive
```

### Global rules that apply platform-wide
1. **Scope-based visibility** — users see only records in their authorized scope (e.g., Sales sees only assigned leads/deals/clients)
2. **Audit logging is mandatory** for views, edits, assignments, approvals, pricing changes, contract actions, credential access, exports
3. **Export restricted to Admin and Super Admin only** — no other role can export, ever
4. **Credential isolation** by service/client/assigned resource
5. **Billing isolation** — only Finance and Admin governance roles can modify billing, invoices, payment settings, adjustments

### Key permission facts most relevant to the modules we're building

| Role | Relevant permissions |
|---|---|
| **Lead Gen Team** | Add/Import/Edit/Assign/View on Leads. **No** deal detail access (stage-movement view only), no pricing, no contracts. Scope: only leads they added/imported or were assigned. |
| **Sales Team** | View assigned leads (cannot add/import). Deal actions explicitly include **Calling, Emailing**, Discovery scheduling, Negotiation meetings, Follow-ups. Can configure pricing (add services/discounts, submit/resubmit for approval) but cannot edit contracts. |
| **Contract Handler** | Sends/resends contracts, edits in Aeon Sign, tracks signatures/acknowledgements. Cannot touch pricing/services/discounts. |
| **BD Manager** | Approves/rejects/overrides pricing for their team; edits contracts in Aeon Sign; team-level visibility only. |
| **BD Admin** | Full department visibility; can override rejected pricing; full contract handling. |
| **Finance Head/Executive** | Full billing/invoice/payment authority; discount override authority (Finance Head). |
| **Onboarding Manager/Executive** | Manage onboarding workflows/credentials/scheduling for opted-in clients only; **cannot** see discounts or pricing breakdown, only final service name and billing package. |

### ⚠️ Open question this raises for the Workflow Engine (§8)
**Emailing and Calling are listed as Sales Team permissions on Deals, not as a Lead Gen Team permission on Leads.** But the cold-outreach workflow engine you asked for operates on **Leads**, before a Deal exists — which is Lead Gen Team's territory per this RBAC doc, and they currently have no email/call permission listed. Two ways to resolve this, worth deciding explicitly:
1. Extend Lead Gen Team's permissions to include automated (not manual) email/SMS sending via the workflow engine — they'd own campaign enrollment, not manual sends
2. Or: the workflow engine's automated sends run under a system/service-account identity regardless of who enrolls the lead, and Lead Gen Team just triggers enrollment (Create-level access to Enrollment, not Email/Call access directly)

Either works — this doc doesn't answer it, so flagging rather than guessing.

### Billing isolation vs. our earlier "team sends payment link" answer
Rule 5 (Billing isolation) restricts billing/payment-settings actions to **Finance and Admin roles only**. Your earlier answer that "sometimes team can send the request for payment method change" should be scoped to Finance Executive/Finance Head/Admin specifically, not any team member, to stay consistent with this rule.

### Approval governance (repeated from §3.4 for completeness)
0–10% discount → BD Manager · 10–20% → Head of BD · >20% → Admin/Finance Head.

### Module permission matrix
Reproduced from your doc for reference — this is the authoritative table for building out access control on every module the platform touches (Leads, Deals, Pricing, Contracts, Billing, Clients, Onboarding, Services & Products, Tasks, Calendar, Reports, Export), broken down per role. Treat this table as-is; nothing to add here except mapping the new Workflow Engine module into it (see the open question above).

---

## 5. Where the Marketing/Sales Engagement Workflow Engine fits

This is worth stating explicitly since your source documents describe a **different, already-well-specified workflow** (the Deal Stage Movement Logic, §3) from the one you originally asked me to help design (the cold-email/call/SMS sequence engine). They're related but distinct:

| | Deal Stage Workflow (§3) | Marketing/Engagement Workflow Engine (§8) |
|---|---|---|
| **Operates on** | Deals (post-Discovery-Meeting) | Leads (pre-Discovery-Meeting) |
| **Nature** | Deterministic business-rule state machine, largely already built | Configurable, AI-assisted, multi-channel sequences — net new |
| **Purpose** | Move a qualified prospect through pricing, contract, and payment to Client | Get a cold/unengaged Lead to *book a Discovery Meeting* in the first place |
| **Owner (per RBAC)** | Sales Team, BD Manager, Contract Handler | Lead Gen Team (see the open RBAC question above) |

**The handoff point is exact and already defined for you**: the marketing workflow engine's job is done — and its exit condition fires — the moment a Discovery Meeting gets scheduled via Aeon Scheduler, which is precisely the trigger documented in §3.1 (`Lead.status → PROSPECT`, Deal created). From that point, §3's logic takes over completely; the marketing workflow engine has no further role for that lead.

---

## 6. Multi-Provider Email Integration (unchanged from last version)

Unified adapter layer over Microsoft Graph, Google Workspace, and Zoho Mail APIs, domain-routed. Click tracking over open tracking (pixel tracking is unreliable). Keep the existing `email_service.ts` nodemailer path exactly as-is for transactional email (OTP, invites, notifications) — this is a new, parallel path for marketing/sequence email only.

---

## 7. Domain Warmup & AI Sending Guardrails (unchanged)

Per-mailbox/domain sending caps that ramp during warmup; a guardrail service reading `Lead.email_deliverability` (already exists) plus bounce/complaint/reply rates to throttle proactively; a per-workflow-template `requires_warmup` flag so webinar/demo sequences can skip it.

**New idea prompted by §3.4**: consider mirroring the Pricing Approval pattern for AI-generated email templates — an "AI Template Approval" status (Pending/Approved/Rejected/Resubmitted) before a template goes live in a cold sequence, owned by whichever role you settle on for Workflow Engine governance (likely BD Admin/BD Manager, paralleling how they own pricing approval). This keeps your governance model consistent across modules rather than introducing a one-off review process just for email.

---

## 8. Workflow / Sequence Engine (net-new, priority — unchanged core design)

| Concept | Design |
|---|---|
| Workflow Template | Named sequence (e.g. "Cold Outreach — DSP Persona"), `requires_warmup` flag |
| Step | `email`, `call_task`, `sms`, `wait` |
| Enrollment | Lead enrolled into a workflow instance; status active/paused/completed/exited |
| Saved List / Segment | Reusable lead groupings, independent of any one workflow |
| Exit condition | Reply received, `Lead.status → PROSPECT` (i.e., Discovery Meeting scheduled — see §5), unsubscribed |

Execution: email step → multi-provider sender (§6); call step → `LeadActivity(kind: call)` task for a rep to place manually via Zoom Phone; SMS step → Zoom Phone SMS API, logged as `LeadActivity(kind: sms)` (add this kind to the existing enum); wait step → pure delay.

---

## 9. Meeting & Webinar Scheduling (Aeon Scheduler) — now precisely scoped

Two distinct usages, both confirmed by your source document:
1. **Discovery meeting booking** — the exact Lead→Deal conversion trigger (§3.1)
2. **Onboarding meeting booking** — triggered immediately after successful payment (§3.9), with an immediate-or-later choice

Plus, from the original request: **webinar scheduling** — a related but distinct case (group event, registrant list, no individual Deal creation), needing its own reminder workflow with `requires_warmup: false`.

Calendar sync (per your doc) should cover: discovery meetings, negotiation meetings, onboarding meetings, follow-ups, reminders — and respect the RBAC calendar visibility rule (own meetings + team meetings for managers + service-related onboarding meetings).

---

## 10. Calling & Messaging: Zoom Phone (unchanged)

Zoom's `POST /v2/phone/sms/messages` covers automated SMS steps; call steps stay manual via Zoom Phone, matching how Sales Team's "Calling" permission is meant to work per RBAC.

---

## 11. Contract E-Signature (Aeon Sign) — now precisely scoped

Confirmed by your document: **Aeon Sign owns templates, editing, delivery, and signature tracking entirely. Aeon Onboard's job is limited to sending the payload and tracking status** (§3.5) — this is a much tighter, clearer integration boundary than my earlier generic "webhook-driven state machine" description, though the mechanism is the same:
- Deal reaches Price-Approval-Approved → Aeon Onboard sends a payload (MSA + auto-selected SOW/SLA per §3.5's template-selection matrix)
- Aeon Sign webhooks return the Draft Sent statuses (§3.6): Proposal Sent, Viewed, Awaiting Signature, Signed, Payment Failed, Correction Requested, Resent Corrected, Expired
- Contract Handler role (RBAC) is the one who sends/resends and tracks — not Sales, per §4

---

## 12. Client Portal & Future Aeon Unified Login (unchanged questions stand)

Still open: does Unified Login replace the existing client-portal auth, or layer on top? Stripe remains the source of truth for payment methods and subscriptions regardless.

---

## 13. Payments, Subscriptions & Invoicing (unchanged, + one RBAC addition)

Per Rule 5 (Billing isolation), payment-method-update links should be sendable only by Finance/Admin roles, not general team members — see §4. Otherwise unchanged: `subscription_model.ts` is solid, still needs a `SubscriptionActivity` audit log for pause/resume/cancel/resubscribe history. QuickBooks-vs-Stripe invoicing question still open.

---

## 14. Future: Social Media Marketing Module (unchanged)

---

## 15. Technical Architecture Recommendations (unchanged, + one addition)

Given the hybrid RBAC model is already your standard, **build the Workflow Engine's permission model the same way** rather than inventing a separate access pattern: role-based defaults (Lead Gen Team vs. Sales Team vs. BD Admin) + scope-based visibility (own/assigned leads only) + audit logging on every enrollment, send, and template change.

---

## 16. Status Snapshot & Open Questions

**Newly confirmed** (from your two documents): the entire Deal Stage Movement Logic (§3) and RBAC architecture (§4) are now documented as source-of-truth — and given `deal_model.ts`'s commit history (`deal_logics_completed_in_discovery_and_price_approval_section`), a substantial part of §3 may already be implemented.

**Open questions, updated**:
1. How much of §3 (Deal Stage Movement Logic) is already built vs. still target design? This determines whether I'm documenting existing behavior or spec'ing new work.
2. **Workflow Engine ownership**: Lead Gen Team has no email/call permission in the RBAC doc, but they own Leads — who actually operates the cold-outreach workflow engine? (§4)
3. Reopened Lost deals move back to "Lead" — which `Lead.status` value should that be? No obvious existing enum value fits "reopened."
4. Is RBAC's "Billing isolation" rule already enforced on the existing payment-method-link feature, or is that still open to any team member as originally described?
5. Still outstanding from before: the in-progress `test_email_2_integrated` work, QuickBooks vs. Stripe as invoicing source of truth, and whether Aeon Unified Login replaces or layers on the existing client portal.

Given how much is now precisely specified, the most useful next step is probably confirming #1 — once I know what's built vs. target, I can produce an actual gap-only implementation plan instead of a full spec that re-describes things you already have.

---

## 17. FINAL ARCHITECTURE DECISION: Two-App Split

After evaluating splitting at "contract sent," the finalized split is **before Price Approval** — right after a Discovery outcome is confirmed Interested. This keeps the entire cyclical Price Approval ↔ Draft Sent ↔ Negotiation & Correction loop (§3.10) inside a single app, so reapproval never crosses a network/data boundary.

### App 1: Growth & Discovery
Owns everything pre-decision.

| Module | Features |
|---|---|
| Lead management | Bulk import/export, saved lists/segments, `Lead.status` lifecycle, deliverability/DND flags, Lead Gen/Sales dashboards |
| Workflow engine | Templates, mixed-channel steps (email/call/SMS/wait), AI generation, step-level A/B testing, domain warmup + guardrails, enrollment |
| Discovery | Aeon Scheduler meeting booking, notes, interested-services capture, outcome recording, auto-tasks |

**Data owned**: Lead, SavedList, WorkflowTemplate, Enrollment, EmailTemplate, LeadActivity, Deal (Discovery-stage only, pre-handoff).

### App 2: Revenue & Delivery
Owns everything from pricing decision onward.

| Module | Features |
|---|---|
| Pricing & approval | Pricing Configuration modal, pricing version history, approval thresholds (0–10%/10–20%/>20%), rejection/resubmission, SLA escalation |
| Contract & payment | Aeon Sign payload + status tracking, MSA/SOW/SLA auto-selection, Draft Sent status machine, contract expiry + reminders, Stripe payment/invoicing |
| Client & subscriptions | Deal Won conversion, Subscription tracking + `SubscriptionActivity` log, Aeon Scheduler onboarding booking, client portal |

**Data owned**: Deal (post-handoff), PricingVersion, Approval, Agreement, Payment, Client, Subscription, SubscriptionActivity, Invoice, OnboardingTask.

### The only two things that cross the boundary

1. **Handoff (App 1 → App 2, routine)**: fires on a confirmed "Interested" Discovery outcome. Payload: lead/contact info, discovery notes, interested services, discovery-history reference. App 2 returns `deal_id`; App 1's Discovery record becomes read-only and linked.
2. **Lost + Reopened (App 2 → App 1, rare)**: only when a deal already handed to App 2 is Lost and later Reopened (per §3.11's rule that reopened deals return to Lead, not their prior stage). App 1 creates/reactivates a Lead.

**Shared across both**: identity/RBAC (Sales reps need both apps, since Negotiation permissions live in App 2's territory), and likely a read-only cross-app reporting layer later, since full-funnel and revenue-forecast reporting (§3.14) span both databases.

### Why this split, not "split at contract sent"
The originally proposed "contract sent" boundary would have cut through the Negotiation-to-Price-Approval reapproval loop, forcing routine round trips between two systems. Splitting one stage earlier keeps that entire cycle inside App 2, leaving only two clean, mostly one-directional events crossing the boundary.

---

## 18. Lost Deal Recycle — finalized design (extends §17's App 1 Lead management)

This formalizes the automatic recycle path and makes it an explicit feature of App 1, not just a backend event handler.

### Trigger
Fires automatically the moment a Deal in App 2 is marked **Lost from Price Approval or Negotiation & Correction** — no manual "reopen" step required. (Discovery-stage Lost deals never left App 1, so this doesn't apply to them.)

### Lost-reason filter
Not every Lost deal recycles. Using the dropdown from §3.11 (Budget, No response, Competitor, Internal decision, Timing, Invalid lead, Other):

| Reason | Recycle? |
|---|---|
| Budget, No response, Competitor, Internal decision, Timing, Other | Yes — reasonable retry candidates |
| Invalid lead | No — never a real prospect, archive only |

*(Worth revisiting this table together — these are sensible defaults, not fixed.)*

### New `Lead` fields (App 1 data model addition)
```
recycled_from_deal_id   // link back to the archived Deal in App 2, for full pricing/negotiation history
lost_reason             // carried over from the Deal, so messaging can address it directly
lost_stage              // "Price Approval" | "Negotiation & Correction"
eligible_for_reengagement_at   // cooldown date; "Timing" losses can carry a specific follow-up date instead of a generic cooldown
```

### New `Lead.status` value
`RECLAIMED` (or `WIN-BACK`) — distinct from `NEW-COLD`, so a recycled lead is never treated as if nothing happened before.

### App 1 feature surface (not just backend logic)
- **Lead management**: a dedicated "Recycled / Win-back" filter/segment, showing `lost_reason`, `lost_stage`, and a link to the prior deal's history — visible to whichever roles you decide should see it (worth a quick RBAC pass, since Lead Gen Team's current permissions don't distinguish this case)
- **Workflow engine**: a distinct **win-back workflow template**, separate from standard cold outreach — messaging acknowledges the prior relationship and the specific reason lost, rather than pitching cold
- **Dashboards**: recycle volume and win-back conversion rate as their own metrics, not folded into general lead-source metrics

### Archived (non-recycled) path
Deals lost with reason "Invalid lead" stay archived in App 2 with no Lead created in App 1 — no further action.

---

## 19. AI Content Grounding — finalized design (not persistent memory)

Rather than a self-updating "memory" (opaque, hard to audit against the platform's mandatory audit-trail requirement), AI email generation is grounded in three explicit, versioned, retrievable sources — each logged per draft for traceability.

| Source | Nature | Used for |
|---|---|---|
| Brand voice guidelines | Static, human-authored (via the enabled Brand Voice plugin), rarely changes | Every generation |
| Winning email library | Retrieved by persona/workflow-type/step match from past high-performing, human-approved templates | Every generation, as few-shot grounding — never copied verbatim |
| Lead's own thread history | Per-lead, dynamic, pulled from `LeadActivity` | Required for reply drafting; not used for cold openers |

**Traceability**: every `EmailTemplateVersion.ai_generation_metadata` records which library examples and guideline version were used to produce it — so any draft can be traced back to what shaped it.

**Cold start**: the Winning Email Library starts empty. Early generation leans on Brand Voice Guidelines plus any existing sales collateral; the library builds organically as templates prove out, with a human-confirmed promotion step (not automatic) when a template crosses a performance threshold.

**Anti-repetition guardrail**: the generation prompt explicitly instructs matching tone/structure from library examples without verbatim reuse — both to keep writing fresh and to avoid the spam-filter risk of identical phrasing sent to many recipients.

---

---

## 20. Multi-Org Support — finalized design

### Org scoping
New `Organization` entity (Aeon Miles, Aeon Sign, Aeon RecruitPro, ...): `enabled_features[]`, `product_context` (feeds AI generation), `brand_voice_guidelines_id` (per-org, not global), `sending_domains[]`. Every existing entity (`Lead`, `Deal`, `WorkflowTemplate`, `EmailTemplate`, `SavedList`) gets an `org_id`. The "foldered library" is this scoping surfaced in the builder UI — pick an org, see only that org's workflows/templates.

### RBAC extension — org + feature, on top of role + scope
```
UserOrgAccess { user_id, org_id, role, features[] }
```
Admin/Super Admin bypass this (full access, all orgs, all features). Every other role needs an explicit `(org, features)` grant — supports a person having different roles/feature-access in different orgs.

### Contact vs. Lead — enables cross-org sharing without merging consent
Split identity from engagement:
- `Contact`: shared across orgs — email, phone, firmographics (dsp_code, drivers, vans, stations), `global_do_not_contact` (hard suppress override)
- `Lead`: one per org per contact — own `status`, own consent/unsubscribe state, own workflow enrollment

Sharing a contact to another org = create a new `Lead` pointing at the same `Contact`, starting fresh in that org's pipeline. An unsubscribe in one org never silently affects another. AI can suggest which other orgs a contact fits, using firmographic data — human with access to both orgs confirms before the new Lead is created.

### Cross-org AI insight sharing — patterns, not content
Two tiers, not one:
- **Abstracted structural patterns** (sequence shape, timing, format) — extracted from performance across all orgs, surfaced to any org's workflow builder as generic recommendations
- **Raw content/performance data** from a specific other org — Admin/Super Admin only, consistent with existing export-restriction rules

### Image placeholders and provider-based deliverability — finalized
Text-only by default, especially for first-touch cold sends, regardless of recipient's email provider. Image inclusion is a joint decision of **provider category + workflow step position**, not provider alone:

```
image_blocks[]   // { placeholder_id, image_url, alt_text, position }
image_policy      // "always" | "never" | "auto"
```
`"auto"` renders or strips the image block at send time based on the recipient's provider category (detected via MX lookup for custom domains, cached) and how early the step is in the sequence. One approved template serves both variants — no duplicate content or double review. AI's role: analyze aggregate bounce/complaint/open data by provider category and propose rule changes to the policy — reviewed before taking effect, same gate as template/workflow changes.

---

---

## 21. Send-Time and Content-Pattern Optimization — finalized design

### Metric consistency with the rest of the system
"Response rate" here means reply rate (or a reply + meeting-booked composite) — **not** open rate, for the same reason established in §19/§20: opens are unreliable (Apple MPP, Gmail proxy caching). Timing analysis optimizes for the metric that actually predicts business outcomes.

### Data model — a rollup, not a live query
```
SendTimePerformance {
  org_id, workflow_type, persona/segment
  day_of_week, hour_bucket, recipient_timezone_bucket
  content_variant_id     // ties time analysis to content — not analyzed independently
  sent_count, reply_rate, meeting_rate, sample_size
}
```
Recomputed on a rolling basis (patterns drift with season/industry rhythm, not fixed once).

### Timezone
Sends are scheduled in the **recipient's** local time (`Contact.timezone`, inferable from area code/address/station geography), not the sender's.

### Configurable autonomy
```
send_time_strategy: "manual" | "ai_suggested" | "ai_automatic"   // per workflow or org
```
`ai_suggested` surfaces a recommended (day/time, content) pairing for review; `ai_automatic` schedules within a validated window without per-send approval. Timing decisions can carry more autonomy than content decisions once validated — they change *when*, not *what's said*.

### Precedence
The sending guardrail service (domain warmup/caps) always takes precedence over the "optimal" time — an optimal slot that exceeds a domain's cap gets queued for the next available window, not forced.

### Deferred
Per-lead individual timing patterns (this specific person always opens at 6pm) — needs more individual data than most leads will have; the persona-level rollup is the right starting point.

---

---

## 22. GA4 / Microsoft Clarity Integration — deferred (deliberate, not forgotten)

**Decision**: not building this now. Revisit if the traffic pattern changes.

**Reasoning**: the workflow engine's dominant CTA pattern is direct-to-Scheduler-booking or reply-driven — both are already first-party signals in this system (`Lead.status → PROSPECT` on meeting booked, `LeadActivity` on reply), more reliable than a GA4 conversion event, and already wired in. GA4/Clarity would only add value for the stretch between an email click and a general marketing/webpage landing — diagnosing landing-page quality, not email quality. That stretch exists for a small share of templates, not enough currently to justify the integration cost (per-org GA4/Clarity credentials, a UTM-tagging pipeline on the click-redirect layer, a new sync job, and Clarity's API likely only exposing aggregate metrics rather than full session data).

**Revisit trigger**: if a meaningful share of workflow templates start routing through general marketing/webpage content before reaching a booking or reply action, this is worth reopening.

---

## 23. App Naming, Finalized Decisions, and Org Context

### App naming, confirmed
- **App 1 (Growth & Discovery) = "Aeon MarkFlow"**
- **App 2 (Revenue & Delivery) = "Aeon Onboard"** (the existing repo we've been analyzing throughout this doc)
- Build order confirmed: **Aeon MarkFlow first, Aeon Onboard's remaining gaps after** — so App 2's open questions (§13, §16) are deliberately deferred, not blocking.

### Workflow engine ownership, finalized (resolves the §4/§16 open question)
| Role | Leads | Workflow engine |
|---|---|---|
| BD-Lead Gen | Upload/monitor only | No access |
| BD-Sales | — | Full access (build, run) |
| BD-Manager | Full | Full |
| Admin | Full | Full |

### QuickBooks vs. Stripe, finalized
Aeon MarkFlow/Onboard generates the invoice → shares it with QuickBooks (accounting record only, not source of truth) → shares payment info to Stripe → **Stripe processes the actual charge**. QuickBooks never initiates a charge; it's a ledger, not a payment path.

### Aeon Unified Login, finalized
Not yet built. When it exists, it's where all client-level users manage account info; **Client Admin/primary admin gets billing access** within it. Confirms (from §12/§20) that Unified Login is a future consolidation point, not a replacement decision to make now.

### Recycled/Win-back lead segment visibility, finalized (resolves §18's open item)
Visible to: **BD-Sales, BD-Manager, Admin.**

### Sending domains, per org — including a real cross-org nuance
| Org | Primary provider | Note |
|---|---|---|
| Aeon Synergies (parent) | Microsoft 365 | Also used to market **Aeon Miles** sometimes |
| Aeon Miles | Google Workspace | — |
| Aeon Sign | Zoho Mail | — |
| Aeon Scheduler | Zoho Mail | — |

**Important for the `Organization.sending_domains[]` design (§20)**: this isn't a strict 1:1 org→domain mapping. Aeon Miles content sometimes sends from the Aeon Synergies (M365) domain. `sending_domains[]` needs to support multiple domains per org, and the DomainRouter (§3/§6) needs to resolve per-send, not assume one domain per org.

All three providers (Microsoft 365, Google Workspace, Zoho Mail) are being integrated together, not staggered by domain.

### Org product context (from public sites — refine as you get internal detail)

**Aeon Miles** — Amazon DSP back-office management suite (payroll, bookkeeping, dispute resolution, analytics, dispatch support, driver recruitment). Sub-products: Aeon Finance, Aeon RecruitPro (DSP-specific module — see naming flag below), Aeon Fleet, Aeon Flow. ICP: Amazon Delivery Service Partners. Partner under Amazon's Vendor Exchange Program.

**Aeon Sign** — e-signature/document workflow platform, currently marketed specifically at logistics hiring/HR documentation (offer letters, candidate document collection, employee write-ups, policy acknowledgments) for Amazon DSP/AFP and FedEx ISP operators, with a broader "any logistics company" tier for contracts/approvals. Product story: **Send → Collect → Track → Store.**

**Aeon RecruitPro** — ⚠️ naming/positioning unresolved, see flag above. Standalone site markets a generic ATS/recruitment platform ("500+ companies," no logistics framing); Aeon Miles' own site describes it as a DSP-specific driver recruitment module. Needs resolution before `product_context` can be written accurately.

**Aeon Scheduler** — meeting scheduling SaaS (Calendly-style): unlimited bookings/event types, custom slot scheduling, analytics dashboard, **payment collection built in**, manual booking wizard, multi-account support. $18/mo + $8/seat (Business tier).

### Build/deployment approach, confirmed
Following the same pattern already established for the **Aeon Presentation** app: Claude Code (desktop app) building against a GitHub repo (`AeonSynergies/...`) with PR + CI + auto-merge, deployed on AWS (App Runner, per Aeon Presentation's precedent). Recommend the same for Aeon MarkFlow once implementation starts — this chat is for spec/architecture; actual code should be built via Claude Code against a real repo, matching existing practice.

---

## 24. Cross-App RBAC, Scheduler Timing, and RecruitPro — finalized

### Aeon RecruitPro — resolved
Genuinely separate product, own market/ICP (generic recruitment platform) — also used internally by the Aeon team to fulfill Aeon Miles' "Driver Recruitment" service line. `product_context` for RecruitPro as an org should reflect its own market, not Aeon Miles' DSP framing; the internal-use relationship is operational, not a marketing signal.

### Aeon Scheduler — event-based decoupling, timing resolved
"Discovery Meeting Scheduled" (§3.1) is built as an abstract event, not tied to a specific trigger source:
- **Phase 1 (no API needed)**: Scheduler URL used as email CTA; a human manually raises the event (a "mark as scheduled" action) to trigger the handoff logic
- **Later**: swap in the Scheduler webhook to raise the same event automatically — a source change, not a redesign

Aeon Sign API: confirmed needed only for Aeon Onboard's build (contract payload/status), not MarkFlow.

### Cross-app RBAC — the grant model
One identity, multiple scoped grants — not one role per user:
```
UserAccessGrant { user_id, app: "markflow" | "onboard", org_id (null = all orgs, Admin/Super Admin only), role, features[] }
```

### Role-to-app mapping, finalized
| Role | MarkFlow | Onboard |
|---|---|---|
| Super Admin / Admin | Full | Full |
| BD Admin | Yes | Yes |
| BD Manager | Full lead + workflow access | Pricing approval, contract oversight |
| BD-Lead Gen | Upload/monitor leads only | — |
| BD-Sales | Full workflow access | Negotiation, pricing config, deal actions |
| Contract Handler | — | Yes |
| Finance Head/Executive | — | Yes |
| Onboarding Manager/Executive | — | Yes |
| Operations Manager/CSM/Executive | — | Yes |
| Support Manager/Executive | — | Yes |

Most roles are single-app; only Sales and BD Manager genuinely straddle both, tracking the App 1 → App 2 handoff boundary already established (§17).

### Flagged for later, not blocking now
Onboard's original RBAC doc assumed a single company, no `org_id` dimension. Once Onboard picks up multi-org data (different pricing catalogs/contract templates/Stripe products per org), it needs the same org-scoping MarkFlow has now. Noted so the grant model (`app`, `org_id`, `role`) is designed for this from the start rather than retrofitted a second time when Onboard work resumes.

---

## 25. Repos, Stack, and Hosting — finalized

### Repos
`aeon-markflow` (frontend) / `aeon-markflow-backend` — separate repos, matching Aeon Onboard's existing convention. Mitigate frontend/backend contract drift with a shared types package or checked-in OpenAPI/Swagger spec, rather than letting the two repos' assumptions silently diverge.

### Stack — same core as Onboard, plus MarkFlow-specific additions
| Layer | Choice |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind v4 + shadcn/Radix + TanStack Query (matches Onboard) |
| Backend | Node.js + Express 5 + TypeScript + Mongoose/MongoDB + JWT/bcrypt + Swagger (matches Onboard) |
| Workflow builder | `@xyflow/react` (React Flow) |
| Async job queue | BullMQ + Redis — new for MarkFlow, needed for send scheduling/guardrail throttling |
| Email adapters | Microsoft Graph client, `googleapis`, axios-based Zoho wrapper |
| AI generation | `@anthropic-ai/sdk` |

### Hosting — matches Aeon Presentation's existing AWS pattern
Backend → App Runner · Frontend → S3 + CloudFront · DB → MongoDB Atlas (confirm alignment with however Onboard is hosted) · Redis → ElastiCache or Upstash · Secrets → AWS Secrets Manager.

### Build execution
Architecture/spec work happens here; actual implementation goes through Claude Code against real repos, following the same PR + CI + auto-merge pattern already established for Aeon Presentation.

---

## 26. Repos and AWS Account — final revision

### Repos: separate frontend/backend, confirmed (revised reasoning)
Kept as two repos (`aeon-markflow`, `aeon-markflow-backend`) — not for consistency with Onboard as originally argued, but because the actual requirement is clean future access separation (one developer frontend-only, another backend-only). GitHub has no folder-level access control within a single repo, so a monorepo couldn't achieve this without added tooling. Separate repos is the correct structure for this specific goal. Mitigate contract drift with a shared types package or checked-in OpenAPI spec once two people are working across the boundary independently.

### AWS: one account for MarkFlow + Onboard together
Revises the earlier "one account per app" default — MarkFlow and Onboard are a tightly-coupled pair (shared identity/RBAC, direct Handoff API calls), so shared-account isolation costs nothing here and cross-account IAM friction would buy nothing. One new AWS account, created as a member account under an AWS Organization (existing account becomes the management/payer account), hosts both apps.

**Open items to confirm**:
- Onboard's backend GitHub page lists `aeon-sign-backend.vercel.app` as a deployed URL — if Onboard has real traffic/data on Vercel currently, moving to AWS App Runner is a genuine migration (containerization, env transfer, DNS cutover), not a fresh deploy. Confirm current live status before treating this as low-risk.
- Aeon Presentation assumed to stay in its current/separate account, not pulled into this new one — confirm.

---

## 27. Onboard Migration Approach and Backend Separation — final

### Clone and extend Onboard, not rebuild
Onboard's current Vercel deployment is internal-testing only (no real data/traffic at stake), so the AWS move is a clean redeploy, not a careful cutover. Confirmed approach: clone the existing repo, containerize the Express backend for App Runner, move secrets to AWS Secrets Manager, and layer in schema additions (`org_id` scoping, `SubscriptionActivity` log) incrementally. Not a rebuild — the Deal Stage Movement Logic already correctly implemented (per commit history) is real, tested value not worth re-deriving from scratch.

### Two backends, not one shared backend
MarkFlow and Onboard stay separate backend services, for three reasons:
1. **Blast radius** — once Onboard handles real Stripe charges and contracts, a MarkFlow-side issue (third-party API flakiness, a runaway job) must not be able to degrade or crash Onboard's uptime. Separate App Runner services fully isolate this.
2. **Future access separation** — same reasoning as the frontend/backend repo split: a shared backend can't give a future hire backend access to one app without the other.
3. **Protects "clone and extend, don't rebuild"** — merging MarkFlow's active construction (new deps, schemas, routes) into Onboard's already-working codebase reintroduces the disruption that principle was meant to avoid.

### Shared identity without a shared backend
Both services validate JWTs signed with the same secret (or share one `Users`/`UserAccessGrant` collection in the same MongoDB cluster) — one login works across both APIs with no live inter-service call required for auth. The only network calls between the two services remain the ones already designed as deliberate business-logic boundaries: the **Handoff event** (App 1 → App 2) and the **Lost + Recycle event** (App 2 → App 1) — both infrequent, both already meant to be a boundary, so a network hop there is the right place for one to exist.

---

## 28. Discovery Handoff Timing, No-Show/Retry Handling, and Pricing Location — finalized

This revises §17's handoff trigger and supersedes the earlier "split before Price Approval" handoff point with a return to the original Deal Stage document's literal trigger.

**Handoff timing**: fires at **Discovery Meeting Scheduled**, not at the "Interested" outcome. Deal creation moves to Onboard the moment scheduling happens; Discovery itself (including no-show/reschedule/follow-up handling) becomes Onboard's domain rather than MarkFlow's. This doesn't reintroduce the reapproval-loop problem §17 was designed to avoid — that loop is specific to Price Approval ↔ Negotiation, which Discovery doesn't touch.

**No-show / cancelled**: immediate revert to MarkFlow via the Lost+Recycle mechanism (§18), landing at a new, fast-cadence status — **`DISCOVERY_RETRY`** — distinct from the slower `RECLAIMED` win-back tier. Deliberately handled in MarkFlow, not a timer sitting in Onboard's Deal list, so it can't get buried among real pricing/contract work and is actively worked by MarkFlow's reminder/workflow engine.

**Reschedule** (before any no-show): stays in Onboard, a status/time update only — no cross-app event.

**`DISCOVERY_RETRY` reschedules successfully**: handoff fires again normally, a new Deal is created in Onboard.

**`DISCOVERY_RETRY` unresolved after 30 days**: automatically graduates to `RECLAIMED`, joining the existing slower win-back mechanism.

**"Follow-up Required"**: stays in Onboard, same treatment as reschedule.

**"Not Interested" (Lost post-call)**: Lost+Recycle, unified with Price-Approval/Negotiation losses — one mechanism for every retry-eligible loss regardless of originating stage.

**Pricing entry**: happens directly in Onboard once the Deal exists there — no MarkFlow-side pricing UI or cross-app sync channel needed; BD-Sales already has Onboard access under the dual-app RBAC model (§24).

**New vocabulary**: `DISCOVERY_RETRY` as a `Lead.status` value; `no_show`/`cancelled_discovery` as `lost_reason` values feeding it.

## 29. Role Restructuring — BD-Marketing, Narrowed BD-Sales, BD_ADMIN Inclusion

Extends §24's role table.

- **BD-Marketing** (new, MarkFlow-only): full workflow building, email/social channels, AI template approval. Takes over `TEMPLATE_APPROVER_ROLES` and the Recycled/Win-back segment from BD-Sales.
- **BD-Sales** (narrowed, still spans both apps per §24): MarkFlow — calling, discovery/onboarding meeting scheduling; pricing entry moves to Onboard per §28. Onboard — negotiation, deal actions, pricing continuation.
- **BD_ADMIN**: added to `TEMPLATE_APPROVER_ROLES` and `SendGuardrail`'s domain-resume gate, resolving the hierarchy inversion where BD Admin (above BD Manager) couldn't approve templates or resume a paused domain while BD Manager could.
- `TEMPLATE_APPROVER_ROLES`: `[SUPER_ADMIN, ADMIN, BD_ADMIN, BD_MANAGER, BD_MARKETING]`.

## 30. On-Demand AI Draft Creation — approved

The AI-draft-creation flow was only reachable internally (Phase 6's automated diagnosis job); no HTTP route existed for a human to request a draft directly. Approved and added: any `TEMPLATE_APPROVER_ROLES` member can request a draft (persona/workflow-position/brief as input), entering the same `DRAFT` → `PENDING_APPROVAL` gate as every other draft.

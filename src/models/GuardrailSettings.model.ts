import { Schema, model, type InferSchemaType, type Types } from 'mongoose';

/**
 * A per-(org, domain) override of SendGuardrail's ramp-up numbers and rate thresholds — every
 * field here is optional; a field left unset means "use the hardcoded default from
 * src/constants/sendGuardrail.ts", not zero. `guardrailSettings.service.ts`'s
 * `resolveGuardrailSettings()` is the only reader that matters: it merges whatever's stored here
 * over those hardcoded defaults, field by field, so an (org, domain) pair with no document at all
 * — every org today — behaves exactly as SendGuardrail always has. See CLAUDE.md's "SendGuardrail
 * settings" section for why this is per-(org, domain) and not per-mailbox: the mailbox-level state
 * that must never pool across mailboxes (ramp elapsed time, pause status) already lives in
 * DomainSendEvent/DomainGuardrailState; these are policy inputs, which apply uniformly to every
 * mailbox on the domain.
 */
const guardrailSettingsSchema = new Schema(
  {
    org_id: { type: Schema.Types.ObjectId, ref: 'Organization', required: true },
    domain: { type: String, required: true, trim: true, lowercase: true },
    ramp_up_starting_daily_cap: { type: Number, min: 1 },
    ramp_up_step_multiplier: { type: Number, min: 1 },
    ramp_up_step_interval_days: { type: Number, min: 1 },
    ramp_up_steady_state_daily_cap: { type: Number, min: 1 },
    guardrail_short_window_hours: { type: Number, min: 1 },
    guardrail_long_window_days: { type: Number, min: 1 },
    guardrail_min_sample_size: { type: Number, min: 0 },
    throttle_bounce_rate: { type: Number, min: 0, max: 1 },
    throttle_complaint_rate: { type: Number, min: 0, max: 1 },
    hard_stop_bounce_rate: { type: Number, min: 0, max: 1 },
    hard_stop_complaint_rate: { type: Number, min: 0, max: 1 },
  },
  { timestamps: true },
);

guardrailSettingsSchema.index({ org_id: 1, domain: 1 }, { unique: true });

export type GuardrailSettingsDocument = InferSchemaType<typeof guardrailSettingsSchema> & { _id: Types.ObjectId };

export const GuardrailSettings = model('GuardrailSettings', guardrailSettingsSchema);

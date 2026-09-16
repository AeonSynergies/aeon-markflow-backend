import {
  GUARDRAIL_LONG_WINDOW_DAYS,
  GUARDRAIL_MIN_SAMPLE_SIZE,
  GUARDRAIL_SHORT_WINDOW_HOURS,
  HARD_STOP_BOUNCE_RATE,
  HARD_STOP_COMPLAINT_RATE,
  RAMP_UP_STARTING_DAILY_CAP,
  RAMP_UP_STEADY_STATE_DAILY_CAP,
  RAMP_UP_STEP_INTERVAL_DAYS,
  RAMP_UP_STEP_MULTIPLIER,
  THROTTLE_BOUNCE_RATE,
  THROTTLE_COMPLAINT_RATE,
} from '../constants/sendGuardrail';
import { GuardrailSettings } from '../models/GuardrailSettings.model';

export interface ResolvedGuardrailSettings {
  rampUpStartingDailyCap: number;
  rampUpStepMultiplier: number;
  rampUpStepIntervalDays: number;
  rampUpSteadyStateDailyCap: number;
  guardrailShortWindowHours: number;
  guardrailLongWindowDays: number;
  guardrailMinSampleSize: number;
  throttleBounceRate: number;
  throttleComplaintRate: number;
  hardStopBounceRate: number;
  hardStopComplaintRate: number;
}

/** The exact values SendGuardrail has always used — see src/constants/sendGuardrail.ts. Every
 * (org, domain) pair with no GuardrailSettings override resolves to precisely this object. */
export const GUARDRAIL_SETTINGS_DEFAULTS: ResolvedGuardrailSettings = {
  rampUpStartingDailyCap: RAMP_UP_STARTING_DAILY_CAP,
  rampUpStepMultiplier: RAMP_UP_STEP_MULTIPLIER,
  rampUpStepIntervalDays: RAMP_UP_STEP_INTERVAL_DAYS,
  rampUpSteadyStateDailyCap: RAMP_UP_STEADY_STATE_DAILY_CAP,
  guardrailShortWindowHours: GUARDRAIL_SHORT_WINDOW_HOURS,
  guardrailLongWindowDays: GUARDRAIL_LONG_WINDOW_DAYS,
  guardrailMinSampleSize: GUARDRAIL_MIN_SAMPLE_SIZE,
  throttleBounceRate: THROTTLE_BOUNCE_RATE,
  throttleComplaintRate: THROTTLE_COMPLAINT_RATE,
  hardStopBounceRate: HARD_STOP_BOUNCE_RATE,
  hardStopComplaintRate: HARD_STOP_COMPLAINT_RATE,
};

const FIELD_MAP = [
  ['ramp_up_starting_daily_cap', 'rampUpStartingDailyCap'],
  ['ramp_up_step_multiplier', 'rampUpStepMultiplier'],
  ['ramp_up_step_interval_days', 'rampUpStepIntervalDays'],
  ['ramp_up_steady_state_daily_cap', 'rampUpSteadyStateDailyCap'],
  ['guardrail_short_window_hours', 'guardrailShortWindowHours'],
  ['guardrail_long_window_days', 'guardrailLongWindowDays'],
  ['guardrail_min_sample_size', 'guardrailMinSampleSize'],
  ['throttle_bounce_rate', 'throttleBounceRate'],
  ['throttle_complaint_rate', 'throttleComplaintRate'],
  ['hard_stop_bounce_rate', 'hardStopBounceRate'],
  ['hard_stop_complaint_rate', 'hardStopComplaintRate'],
] as const;

type StoredOverride = Partial<Record<(typeof FIELD_MAP)[number][0], number | null>> | null;

function mergeSettings(override: StoredOverride): ResolvedGuardrailSettings {
  if (!override) return GUARDRAIL_SETTINGS_DEFAULTS;

  const resolved = { ...GUARDRAIL_SETTINGS_DEFAULTS };
  for (const [storedField, resolvedField] of FIELD_MAP) {
    const value = override[storedField];
    if (value !== undefined && value !== null) {
      resolved[resolvedField] = value;
    }
  }
  return resolved;
}

/** Which fields (resolved-name form) are actually overridden for this (org, domain) pair — used
 * only to annotate the Settings-screen response, never by the SendGuardrail read path itself. */
function overriddenFields(override: StoredOverride): (keyof ResolvedGuardrailSettings)[] {
  if (!override) return [];
  return FIELD_MAP.filter(([storedField]) => override[storedField] !== undefined && override[storedField] !== null).map(
    ([, resolvedField]) => resolvedField,
  );
}

/**
 * Resolves the effective SendGuardrail settings for one (org, domain) pair. Any field not
 * explicitly overridden in this org's own GuardrailSettings document falls back to the same
 * hardcoded default SendGuardrail has always used — an org that has never configured an override
 * behaves byte-for-byte as before this existed. This is the only place sendGuardrail.service.ts
 * reads these numbers from now on; the reading/enforcement *logic* there (rolling windows, rate
 * comparisons, the ramp-up formula) is unchanged, only the source of each input moved from a
 * direct constant import to this resolution.
 */
export async function resolveGuardrailSettings(orgId: string, domain: string): Promise<ResolvedGuardrailSettings> {
  const override = await GuardrailSettings.findOne({ org_id: orgId, domain }).lean();
  return mergeSettings(override);
}

export interface GuardrailSettingsView {
  orgId: string;
  domain: string;
  settings: ResolvedGuardrailSettings;
  hasOverride: boolean;
  overriddenFields: (keyof ResolvedGuardrailSettings)[];
}

export async function getGuardrailSettingsView(orgId: string, domain: string): Promise<GuardrailSettingsView> {
  const override = await GuardrailSettings.findOne({ org_id: orgId, domain }).lean();
  return {
    orgId,
    domain,
    settings: mergeSettings(override),
    hasOverride: Boolean(override),
    overriddenFields: overriddenFields(override),
  };
}

export async function listGuardrailSettingsViewsForOrg(orgId: string, domains: string[]): Promise<GuardrailSettingsView[]> {
  return Promise.all(domains.map((domain) => getGuardrailSettingsView(orgId, domain)));
}

export interface GuardrailSettingsInput {
  ramp_up_starting_daily_cap?: number;
  ramp_up_step_multiplier?: number;
  ramp_up_step_interval_days?: number;
  ramp_up_steady_state_daily_cap?: number;
  guardrail_short_window_hours?: number;
  guardrail_long_window_days?: number;
  guardrail_min_sample_size?: number;
  throttle_bounce_rate?: number;
  throttle_complaint_rate?: number;
  hard_stop_bounce_rate?: number;
  hard_stop_complaint_rate?: number;
}

/** Upserts the override for one (org, domain) pair. Only the fields present in `input` are
 * written — a field left out keeps its previously-stored value (or stays unset/default), the
 * same partial-PATCH semantics as everywhere else in this codebase (e.g. updateWorkflowTemplate).
 * Pass a field's key with `undefined` to leave it alone; there is no way to explicitly clear a
 * single field back to default short of deleteGuardrailSettings, which clears all of them. */
export async function upsertGuardrailSettings(
  orgId: string,
  domain: string,
  input: GuardrailSettingsInput,
): Promise<GuardrailSettingsView> {
  const set: Record<string, number> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) set[key] = value;
  }

  await GuardrailSettings.findOneAndUpdate(
    { org_id: orgId, domain },
    { $set: { org_id: orgId, domain, ...set } },
    { upsert: true },
  );

  return getGuardrailSettingsView(orgId, domain);
}

/** Removes the override entirely — every field for this (org, domain) reverts to the hardcoded
 * default. Idempotent: deleting a pair with no override is a harmless no-op. */
export async function deleteGuardrailSettings(orgId: string, domain: string): Promise<void> {
  await GuardrailSettings.deleteOne({ org_id: orgId, domain });
}

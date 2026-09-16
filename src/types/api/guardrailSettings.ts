/**
 * Request/response contract for the Settings screen's SendGuardrail override endpoints. Also the
 * source of truth mirrored into the generated OpenAPI spec (see scripts/generateOpenApi.ts).
 */
export interface UpsertGuardrailSettingsRequest {
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

export interface GuardrailSettingsResponse {
  org_id: string;
  domain: string;
  ramp_up_starting_daily_cap: number;
  ramp_up_step_multiplier: number;
  ramp_up_step_interval_days: number;
  ramp_up_steady_state_daily_cap: number;
  guardrail_short_window_hours: number;
  guardrail_long_window_days: number;
  guardrail_min_sample_size: number;
  throttle_bounce_rate: number;
  throttle_complaint_rate: number;
  hard_stop_bounce_rate: number;
  hard_stop_complaint_rate: number;
  /** Whether any field below differs from the hardcoded default in src/constants/sendGuardrail.ts. */
  has_override: boolean;
  /** Which specific fields (camelCase, matching ResolvedGuardrailSettings) are overridden. */
  overridden_fields: string[];
}

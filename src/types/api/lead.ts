/**
 * Response contract for the Leads-screen listing endpoint. Also the source of truth mirrored
 * into the generated OpenAPI spec (see scripts/generateOpenApi.ts).
 */
export interface LeadResponse {
  _id: string;
  org_id: string;
  contact_id: string;
  /** From the lead's shared Contact — null until it's been captured. */
  name: string | null;
  /** From the lead's shared Contact — null until it's been captured. */
  company: string | null;
  email: string | null;
  phone: string | null;
  status: string;
  email_deliverability: string;
  phone_dnd_status: boolean;
  /** Recycled/Win-back segment only (status RECLAIMED or DISCOVERY_RETRY) — null otherwise. */
  lost_reason: string | null;
  /** Recycled/Win-back segment only (status RECLAIMED or DISCOVERY_RETRY) — null otherwise. */
  lost_stage: string | null;
  recycled_from_deal_id: string | null;
  eligible_for_reengagement_at: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Request contract for the Lost+Recycle event's receiving endpoint (see
 * leadRecycle.service.ts's recycleLead). deal_id/lost_reason/lost_stage are all required —
 * lost_reason is free text, but a value in DISCOVERY_RETRY_LOST_REASONS
 * (no_show/cancelled_discovery) routes to the DISCOVERY_RETRY tier instead of RECLAIMED.
 */
export interface RecycleLeadRequest {
  deal_id: string;
  lost_reason: string;
  lost_stage: string;
  eligible_for_reengagement_at?: string;
}

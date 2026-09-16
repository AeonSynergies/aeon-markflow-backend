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
  /** Recycled/Win-back segment only (status RECLAIMED) — null otherwise. */
  lost_reason: string | null;
  /** Recycled/Win-back segment only (status RECLAIMED) — null otherwise. */
  lost_stage: string | null;
  recycled_from_deal_id: string | null;
  eligible_for_reengagement_at: string | null;
  createdAt: string;
  updatedAt: string;
}

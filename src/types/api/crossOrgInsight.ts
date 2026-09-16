/**
 * Cross-org insight API contract (Phase 8). Two views of the same underlying CrossOrgInsight
 * collection: a generic one any workflow-access role can see (coarse confidence label, no
 * numbers), and a raw one restricted to Admin/Super Admin (exact org_count/sample_size/rates).
 * See scripts/generateOpenApi.ts — keep this in sync with config/openapi.ts.
 */

export interface CrossOrgInsightResponse {
  insight_type: string;
  workflow_type: string | null;
  persona: string | null;
  step_kinds?: string[];
  step_count?: number;
  day_of_week?: number;
  hour_bucket?: number;
  timezone_bucket?: string;
  confidence: string;
}

export interface RawCrossOrgInsightResponse extends CrossOrgInsightResponse {
  org_count: number;
  sample_size: number;
  avg_reply_rate?: number;
  avg_meeting_rate?: number;
  computed_at: string;
}

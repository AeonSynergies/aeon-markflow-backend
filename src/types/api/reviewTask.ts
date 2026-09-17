import type { ReviewTaskKind, ReviewTaskStatus } from '../../constants/reviewTask';

export interface ReviewTaskResponse {
  _id: string;
  org_id: string;
  kind: ReviewTaskKind;
  email_template_version_id?: string | null;
  domain?: string | null;
  mailbox?: string | null;
  send_time_recommendation_id?: string | null;
  lead_id?: string | null;
  lead_activity_id?: string | null;
  status: ReviewTaskStatus;
  requested_by?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  rejection_reason?: string | null;
  createdAt: string;
  updatedAt: string;
}

import type { ReviewTaskKind, ReviewTaskStatus } from '../constants/reviewTask';
import { ReviewTask, type ReviewTaskDocument } from '../models/ReviewTask.model';

export interface ListReviewTasksFilters {
  status?: ReviewTaskStatus;
  kind?: ReviewTaskKind;
}

/** Defaults to OPEN — an org's review queue cares about what's actionable right now, not its
 * full history of already-resolved tasks. Pass status explicitly to see APPROVED/REJECTED ones. */
export async function listReviewTasksForOrg(
  orgId: string,
  filters: ListReviewTasksFilters = {},
): Promise<ReviewTaskDocument[]> {
  return ReviewTask.find({
    org_id: orgId,
    status: filters.status ?? 'OPEN',
    ...(filters.kind ? { kind: filters.kind } : {}),
  }).sort({ createdAt: -1 });
}

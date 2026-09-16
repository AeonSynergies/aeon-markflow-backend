/**
 * Request/response contract for the SavedList bulk-action endpoints behind the Leads screen.
 * Also the source of truth mirrored into the generated OpenAPI spec (see
 * scripts/generateOpenApi.ts).
 */
export interface CreateSavedListRequest {
  name: string;
  /** Bulk-selected lead ids to seed the list with, if any — every id must belong to this org's own Lead records. */
  lead_ids?: string[];
}

export interface AddLeadsToSavedListRequest {
  lead_ids: string[];
}

export interface SavedListResponse {
  _id: string;
  org_id: string;
  name: string;
  lead_count: number;
  created_by: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedListBulkActionResponse {
  saved_list: SavedListResponse;
  /** Lead ids actually added — excludes ids already on the list and ids not belonging to this org. */
  added_count: number;
  skipped_count: number;
}

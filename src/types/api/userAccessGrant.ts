import type { App, Role } from '../../constants/access';

/**
 * Request/response contract for the Settings screen's UserAccessGrant management endpoints.
 * Also the source of truth mirrored into the generated OpenAPI spec (see
 * scripts/generateOpenApi.ts).
 */
export interface CreateUserAccessGrantRequest {
  user_id: string;
  app: App;
  /** Omit to default to the URL's orgId. Pass null explicitly for "all orgs" access — the
   * caller must already hold all-orgs access themselves to grant it. */
  org_id?: string | null;
  role: Role;
  features?: string[];
}

export interface UpdateUserAccessGrantRequest {
  role?: Role;
  features?: string[];
}

export interface UserAccessGrantResponse {
  _id: string;
  user_id: string;
  user_email: string | null;
  app: App;
  org_id: string | null;
  role: Role;
  features: string[];
  createdAt: string;
  updatedAt: string;
}

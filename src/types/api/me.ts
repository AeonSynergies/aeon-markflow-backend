import type { Role } from '../../constants/access';

/**
 * Request/response contract for the frontend's own-identity/access endpoint. Also the source of
 * truth mirrored into the generated OpenAPI spec (see scripts/generateOpenApi.ts).
 */
export interface MeOrgSummary {
  id: string;
  name: string;
}

export interface MeResponse {
  user: {
    id: string;
    email: string;
  };
  org_access: {
    /** true when the user holds a grant with org_id: null for this app (access to all orgs). */
    all_orgs: boolean;
    /** Every role the user holds across their markflow grants — not scoped per org (matches
     * requireRole's own enforcement, which checks this same flat set, not a per-org one). */
    roles: Role[];
  };
  /** Every org the user can access — every Organization when org_access.all_orgs is true,
   * otherwise just the ones they hold an explicit grant for. Sorted by name, for a stable
   * org-switcher order. */
  orgs: MeOrgSummary[];
}

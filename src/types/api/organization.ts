import type { SendingDomainPurpose, SenderMailboxStatus } from '../../constants/organization';
import type { SendTimeStrategy } from '../../constants/sendTimeOptimization';

/**
 * Request/response contract for the Settings screen's org-configuration endpoints. Also the
 * source of truth mirrored into the generated OpenAPI spec (see scripts/generateOpenApi.ts).
 */
export interface SenderMailboxInput {
  address: string;
  display_name?: string | null;
  status?: SenderMailboxStatus;
}

export interface SendingDomainInput {
  domain: string;
  purpose: SendingDomainPurpose;
  mailboxes?: SenderMailboxInput[];
}

export interface UpdateOrganizationSettingsRequest {
  enabled_features?: string[];
  /** Full replace — the entire sending_domains[] array, not a merge. */
  sending_domains?: SendingDomainInput[];
  send_time_strategy?: SendTimeStrategy;
}

export interface SenderMailboxResponse {
  address: string;
  display_name: string | null;
  status: SenderMailboxStatus;
}

export interface SendingDomainResponse {
  domain: string;
  purpose: SendingDomainPurpose;
  mailboxes: SenderMailboxResponse[];
}

export interface OrganizationSettingsResponse {
  _id: string;
  name: string;
  enabled_features: string[];
  product_context: string;
  /** Never actually populated or read by anything today — see brandVoice.service.ts. */
  brand_voice_guidelines_id: string | null;
  sending_domains: SendingDomainResponse[];
  send_time_strategy: SendTimeStrategy;
  createdAt: string;
  updatedAt: string;
}

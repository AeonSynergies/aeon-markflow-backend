import type { SendTimeStrategy } from '../constants/sendTimeOptimization';
import { Organization, type OrganizationDocument } from '../models/Organization.model';
import type { SendingDomainInput } from '../types/api/organization';
import { OrganizationNotFoundError } from './enrollment.service';

export interface UpdateOrganizationSettingsInput {
  enabled_features?: string[];
  /** Full replace, same semantics as updateWorkflowTemplate's own `steps` — whatever array is
   * passed becomes the org's entire sending_domains[], not a merge. Mongoose fills in each
   * entry's own defaults (mailboxes: [], a mailbox's status: 'active', etc.) on save. */
  sending_domains?: SendingDomainInput[];
  send_time_strategy?: SendTimeStrategy;
}

export async function getOrganizationSettings(orgId: string): Promise<OrganizationDocument> {
  const org = await Organization.findById(orgId);
  if (!org) throw new OrganizationNotFoundError(orgId);
  return org;
}

/**
 * Updates exactly the fields the Settings screen owns: enabled_features[], sending_domains[]
 * (domain/purpose/mailboxes), and send_time_strategy. Deliberately leaves name, product_context,
 * and brand_voice_guidelines_id untouched — none of those were asked for here, and the latter is
 * unused/dangling today anyway (see brandVoice.service.ts).
 */
export async function updateOrganizationSettings(
  orgId: string,
  updates: UpdateOrganizationSettingsInput,
): Promise<OrganizationDocument> {
  const org = await Organization.findById(orgId);
  if (!org) throw new OrganizationNotFoundError(orgId);

  if (updates.enabled_features !== undefined) org.set('enabled_features', updates.enabled_features);
  if (updates.sending_domains !== undefined) org.set('sending_domains', updates.sending_domains);
  if (updates.send_time_strategy !== undefined) org.send_time_strategy = updates.send_time_strategy;

  await org.save();
  return org;
}

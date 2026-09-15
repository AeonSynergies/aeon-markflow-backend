import type { EmailProvider } from './EmailProvider';
import { GoogleWorkspaceProvider } from './GoogleWorkspaceProvider';
import { MicrosoftGraphProvider } from './MicrosoftGraphProvider';
import type { EmailProviderName } from './types';
import { ZohoMailProvider } from './ZohoMailProvider';

const factories: Record<EmailProviderName, () => EmailProvider> = {
  microsoft_graph: () => new MicrosoftGraphProvider(),
  google_workspace: () => new GoogleWorkspaceProvider(),
  zoho_mail: () => new ZohoMailProvider(),
};

const instances = new Map<EmailProviderName, EmailProvider>();

/**
 * Returns a cached provider instance, constructing (and validating its credentials) on first
 * use rather than eagerly at startup — a deployment only configured for one or two providers
 * shouldn't fail to boot over the others' missing env vars.
 */
export function getEmailProvider(name: EmailProviderName): EmailProvider {
  let instance = instances.get(name);
  if (!instance) {
    instance = factories[name]();
    instances.set(name, instance);
  }
  return instance;
}

/** Test-only: clears cached provider instances so credential/env changes take effect. */
export function resetEmailProviderCache(): void {
  instances.clear();
}

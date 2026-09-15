import type { EmailTemplateVersionStatus, GenerationSource, ImagePolicy } from '../../constants/emailTemplate';

/**
 * Read contract for EmailTemplate/EmailTemplateVersion — lets the workflow builder (aeon-markflow)
 * populate its "pick an approved EmailTemplateVersion" step selector without redefining these
 * shapes locally. Also mirrored into the generated OpenAPI spec (see src/config/openapi.ts).
 */

export interface EmailTemplateResponse {
  _id: string;
  org_id: string;
  name: string;
  persona?: string;
  workflow_position?: string;
  current_version_id?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailTemplateVersionResponse {
  _id: string;
  email_template_id: string;
  version_number: number;
  subject_line: string;
  body_html: string;
  image_policy: ImagePolicy;
  generation_source: GenerationSource;
  status: EmailTemplateVersionStatus;
  createdAt: string;
  updatedAt: string;
}

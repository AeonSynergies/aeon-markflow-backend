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
  intended_workflow_type?: string;
  current_version_id?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One WorkflowTemplate step currently pinned to a version of the queried EmailTemplate. */
export interface EmailTemplateUsageResponse {
  workflow_template_id: string;
  workflow_template_name: string;
  workflow_type: string | null;
  step_index: number;
  email_template_version_id: string;
  version_number: number;
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

export interface RejectEmailTemplateVersionRequest {
  reason: string;
}

/** Both optional — resubmitting without edits (e.g. after a purely external fix) is valid. */
export interface ResubmitEmailTemplateVersionRequest {
  subject_line?: string;
  body_html?: string;
}

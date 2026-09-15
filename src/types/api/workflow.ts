import type { StepKind, WaitUnit } from '../../constants/workflow';

/**
 * Shared request/response contract for the workflow template + enrollment API. Also the source
 * of truth mirrored into the generated OpenAPI spec (see scripts/generateOpenApi.ts) — keep
 * this file in sync with the JSDoc annotations on the routes that use it.
 */

export interface WorkflowStepInput {
  kind: StepKind;
  /** Required, email only — a specific already-approved EmailTemplateVersion id, never "latest". */
  email_template_version_id?: string;
  /** Required, email only. */
  sending_domain?: string;
  /** Required, sms only. */
  sms_body?: string;
  /** Required, call_task only. */
  call_task_instructions?: string;
  /** Required, wait only. */
  wait_amount?: number;
  /** Required, wait only. */
  wait_unit?: WaitUnit;
}

export interface WorkflowStepResponse extends WorkflowStepInput {
  _id: string;
}

export interface CreateWorkflowTemplateRequest {
  name: string;
  requires_warmup?: boolean;
  /** Free-text category (e.g. "cold_outreach") used to roll up send-time performance across templates. */
  workflow_type?: string;
  steps: WorkflowStepInput[];
}

export interface UpdateWorkflowTemplateRequest {
  name?: string;
  requires_warmup?: boolean;
  workflow_type?: string;
  steps?: WorkflowStepInput[];
}

export interface WorkflowTemplateResponse {
  _id: string;
  org_id: string;
  name: string;
  requires_warmup: boolean;
  workflow_type: string | null;
  steps: WorkflowStepResponse[];
  createdAt: string;
  updatedAt: string;
}

export interface EnrollSavedListRequest {
  saved_list_id: string;
}

export interface EnrollSavedListResponse {
  enrolled_count: number;
  skipped_count: number;
  enrollment_ids: string[];
}

export interface ErrorResponse {
  error: string;
}

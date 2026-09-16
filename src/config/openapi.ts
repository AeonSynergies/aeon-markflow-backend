import path from 'path';
import swaggerJSDoc from 'swagger-jsdoc';

/**
 * OpenAPI spec generated from the @openapi JSDoc blocks on each route file, plus the component
 * schemas mirrored from src/types/api/*.ts. This is the contract aeon-markflow (the frontend
 * repo) should build against — see scripts/generateOpenApi.ts for the committed JSON artifact.
 */
export function buildOpenApiSpec(): object {
  const options: swaggerJSDoc.OAS3Options = {
    definition: {
      openapi: '3.0.3',
      info: {
        title: 'Aeon MarkFlow API',
        version: '0.1.0',
        description: "Aeon MarkFlow backend API — leads, engagement workflows, discovery calls.",
      },
      servers: [{ url: '/' }],
      components: {
        schemas: {
          WorkflowStepInput: {
            type: 'object',
            required: ['kind'],
            properties: {
              kind: { type: 'string', enum: ['email', 'call_task', 'sms', 'wait'] },
              email_template_version_id: {
                type: 'string',
                description: 'Required, email only — pins a specific approved EmailTemplateVersion, never "latest".',
              },
              sending_domain: { type: 'string', description: 'Required, email only.' },
              sms_body: { type: 'string', description: 'Required, sms only.' },
              call_task_instructions: { type: 'string', description: 'Required, call_task only.' },
              wait_amount: { type: 'number', description: 'Required, wait only.' },
              wait_unit: { type: 'string', enum: ['minutes', 'hours', 'days'], description: 'Required, wait only.' },
            },
          },
          WorkflowStepResponse: {
            allOf: [
              { $ref: '#/components/schemas/WorkflowStepInput' },
              { type: 'object', required: ['_id'], properties: { _id: { type: 'string' } } },
            ],
          },
          CreateWorkflowTemplateRequest: {
            type: 'object',
            required: ['name', 'steps'],
            properties: {
              name: { type: 'string' },
              requires_warmup: { type: 'boolean', default: false },
              workflow_type: {
                type: 'string',
                description: 'Free-text category (e.g. "cold_outreach") used to roll up send-time performance across templates.',
              },
              steps: { type: 'array', items: { $ref: '#/components/schemas/WorkflowStepInput' } },
            },
          },
          UpdateWorkflowTemplateRequest: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              requires_warmup: { type: 'boolean' },
              workflow_type: { type: 'string' },
              steps: { type: 'array', items: { $ref: '#/components/schemas/WorkflowStepInput' } },
            },
          },
          WorkflowTemplateResponse: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              org_id: { type: 'string' },
              name: { type: 'string' },
              requires_warmup: { type: 'boolean' },
              workflow_type: { type: 'string', nullable: true },
              steps: { type: 'array', items: { $ref: '#/components/schemas/WorkflowStepResponse' } },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
          EnrollSavedListRequest: {
            type: 'object',
            required: ['saved_list_id'],
            properties: { saved_list_id: { type: 'string' } },
          },
          EnrollSavedListResponse: {
            type: 'object',
            properties: {
              enrolled_count: { type: 'integer' },
              skipped_count: { type: 'integer' },
              enrollment_ids: { type: 'array', items: { type: 'string' } },
            },
          },
          ErrorResponse: {
            type: 'object',
            properties: { error: { type: 'string' } },
          },
          EmailTemplateResponse: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              org_id: { type: 'string' },
              name: { type: 'string' },
              persona: { type: 'string' },
              workflow_position: { type: 'string' },
              current_version_id: { type: 'string', nullable: true },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
          EmailTemplateVersionResponse: {
            type: 'object',
            properties: {
              _id: { type: 'string' },
              email_template_id: { type: 'string' },
              version_number: { type: 'integer' },
              subject_line: { type: 'string' },
              body_html: { type: 'string' },
              image_policy: { type: 'string', enum: ['always', 'never', 'auto'] },
              generation_source: { type: 'string', enum: ['ai', 'human', 'ai_edited_by_human'] },
              status: {
                type: 'string',
                enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'RESUBMITTED'],
              },
              createdAt: { type: 'string', format: 'date-time' },
              updatedAt: { type: 'string', format: 'date-time' },
            },
          },
          CrossOrgInsightResponse: {
            type: 'object',
            properties: {
              insight_type: { type: 'string', enum: ['sequence_shape', 'step_count', 'send_time_window'] },
              workflow_type: { type: 'string', nullable: true },
              persona: { type: 'string', nullable: true },
              step_kinds: { type: 'array', items: { type: 'string' } },
              step_count: { type: 'integer' },
              day_of_week: { type: 'integer' },
              hour_bucket: { type: 'integer' },
              timezone_bucket: { type: 'string' },
              confidence: { type: 'string', enum: ['emerging', 'established'] },
            },
          },
          RawCrossOrgInsightResponse: {
            allOf: [
              { $ref: '#/components/schemas/CrossOrgInsightResponse' },
              {
                type: 'object',
                properties: {
                  org_count: { type: 'integer' },
                  sample_size: { type: 'integer' },
                  avg_reply_rate: { type: 'number' },
                  avg_meeting_rate: { type: 'number' },
                  computed_at: { type: 'string', format: 'date-time' },
                },
              },
            ],
          },
        },
      },
    },
    // Resolved relative to this file's own on-disk location (not process.cwd()) so it finds the
    // route files whether running from src via tsx or from a compiled dist build.
    apis: [path.join(__dirname, '../routes/*.{ts,js}')],
  };

  return swaggerJSDoc(options);
}

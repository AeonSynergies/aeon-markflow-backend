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
              steps: { type: 'array', items: { $ref: '#/components/schemas/WorkflowStepInput' } },
            },
          },
          UpdateWorkflowTemplateRequest: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              requires_warmup: { type: 'boolean' },
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
        },
      },
    },
    // Resolved relative to this file's own on-disk location (not process.cwd()) so it finds the
    // route files whether running from src via tsx or from a compiled dist build.
    apis: [path.join(__dirname, '../routes/*.{ts,js}')],
  };

  return swaggerJSDoc(options);
}

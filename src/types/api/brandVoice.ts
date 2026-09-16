/**
 * Request/response contract for the Settings screen's Brand Voice guideline editing endpoints.
 * Also the source of truth mirrored into the generated OpenAPI spec (see
 * scripts/generateOpenApi.ts).
 */
export interface UpdateBrandVoiceGuidelinesRequest {
  text: string;
}

export interface BrandVoiceGuidelinesResponse {
  text: string;
  version: string;
}

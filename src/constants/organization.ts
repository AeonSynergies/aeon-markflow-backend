// Product lines currently onboarding to MarkFlow (per CLAUDE.md "Org product context").
export const PRODUCT_CONTEXTS = ['aeon_miles', 'aeon_sign', 'aeon_recruitpro', 'aeon_scheduler'] as const;
export type ProductContext = (typeof PRODUCT_CONTEXTS)[number];

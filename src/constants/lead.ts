export const LEAD_STATUSES = [
  'NEW-COLD',
  'NEW-INBOUND',
  'CONTACTED',
  'CONTACTED-PHONE',
  'CONTACTED-EMAIL',
  'PROSPECT',
  'INACTIVE',
  'RECLAIMED',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const EMAIL_DELIVERABILITY_STATUSES = ['GOOD', 'LOW', 'BAD'] as const;
export type EmailDeliverabilityStatus = (typeof EMAIL_DELIVERABILITY_STATUSES)[number];

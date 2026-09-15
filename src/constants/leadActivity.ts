export const LEAD_ACTIVITY_KINDS = ['email', 'call', 'sms', 'meeting', 'task', 'note'] as const;
export type LeadActivityKind = (typeof LEAD_ACTIVITY_KINDS)[number];

export const LEAD_ACTIVITY_DIRECTIONS = ['inbound', 'outbound'] as const;
export type LeadActivityDirection = (typeof LEAD_ACTIVITY_DIRECTIONS)[number];

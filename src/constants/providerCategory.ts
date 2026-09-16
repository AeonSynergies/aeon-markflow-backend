export const PROVIDER_CATEGORIES = ['consumer', 'corporate'] as const;
export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

/**
 * Well-known free/personal webmail brands — checked first, before any DNS lookup, since these
 * are unambiguous by domain name alone. Not exhaustive; the fallback for anything else is an MX
 * lookup (see providerCategory.service.ts).
 */
export const CONSUMER_WEBMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.co.in',
  'yahoo.fr',
  'yahoo.de',
  'ymail.com',
  'rocketmail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'outlook.com',
  'outlook.co.uk',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'protonmail.com',
  'proton.me',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'web.de',
  'mail.ru',
  'qq.com',
  '163.com',
  'sina.com',
  'naver.com',
  'comcast.net',
  'verizon.net',
  'att.net',
  'sbcglobal.net',
  'bellsouth.net',
  'cox.net',
]);

/**
 * ============================================================================================
 * PROPOSED DEFAULTS — REVIEW BEFORE RELYING ON THEM
 * ============================================================================================
 * MX records rarely change, so a lookup is cached for a long time to avoid a DNS round trip on
 * every send. A domain not in CONSUMER_WEBMAIL_DOMAINS that resolves real MX records — or whose
 * lookup fails outright (NXDOMAIN, no MX) — both default to "corporate": the MX lookup mostly
 * confirms real mail infrastructure exists and records it (mx_hosts) for a human to look at, not
 * a further consumer/corporate split. Distinguishing e.g. cheap shared hosting from a dedicated
 * corporate mail setup by MX pattern would need real deliverability data to calibrate — not
 * attempted here rather than guessed at.
 */
export const PROVIDER_CATEGORY_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

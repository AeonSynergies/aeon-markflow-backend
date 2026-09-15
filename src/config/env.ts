import dotenv from 'dotenv';

dotenv.config();

function required(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: required('MONGODB_URI', 'mongodb://localhost:27017/aeon_markflow'),
  jwtSecret: required('JWT_SECRET', 'dev-only-insecure-secret'),
  // Email-provider credentials (MS_*/GOOGLE_*/ZOHO_*) are intentionally not validated here —
  // each EmailProvider adapter reads and validates its own env vars lazily on first use, so a
  // deployment missing one provider's credentials doesn't fail to boot over the others.
  trackingBaseUrl: process.env.TRACKING_BASE_URL ?? `http://localhost:${process.env.PORT ?? 4000}`,
};

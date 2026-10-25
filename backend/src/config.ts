export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigins: string[];
  trustProxyHops: number;
  databaseUrl: string;
  jwtSecret: string;
  accessTokenTtl: string;
  refreshTokenTtlDays: number;
  duplicateRadiusM: number;
  duplicateWindowHours: number;
  appBaseUrl: string;
  smtpUrl?: string;
  mailFrom: string;
  requireVerifiedEmail: boolean;
  redisUrl?: string;
  googleClientIds: string[];
  firebaseServiceAccountBase64?: string;
  storage: { bucket?: string; endpoint?: string; region: string; accessKey?: string; secretKey?: string; publicBaseUrl?: string };
}

const INSECURE_DEFAULT = 'change-me-dev-only-change-me-dev-only';

export function getConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const jwtSecret = env.JWT_SECRET ?? INSECURE_DEFAULT;
  if (nodeEnv === 'production' && (jwtSecret === INSECURE_DEFAULT || jwtSecret.length < 32)) {
    throw new Error('JWT_SECRET must be set to a strong value (>= 32 chars) in production');
  }
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const redisUrl = env.REDIS_URL || undefined;
  if (nodeEnv === 'production' && !redisUrl) {
    throw new Error('REDIS_URL is required in production for shared rate limiting');
  }
  return {
    nodeEnv,
    port: Number(env.PORT ?? 3000),
    corsOrigins: (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    databaseUrl,
    jwtSecret,
    accessTokenTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    trustProxyHops: Number.isInteger(Number(env.TRUST_PROXY)) && Number(env.TRUST_PROXY) > 0 ? Number(env.TRUST_PROXY) : 0,
    refreshTokenTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    duplicateRadiusM: Number(env.DUPLICATE_RADIUS_M ?? 50),
    duplicateWindowHours: Number(env.DUPLICATE_WINDOW_HOURS ?? 24),
    appBaseUrl: (env.APP_BASE_URL ?? `http://localhost:${env.PORT ?? 3000}`).replace(/\/$/, ''),
    smtpUrl: env.SMTP_URL || undefined, // e.g. smtps://user:pass@smtp.example.com:465
    mailFrom: env.MAIL_FROM ?? 'CivicLens <no-reply@civiclens.local>',
    requireVerifiedEmail: env.REQUIRE_VERIFIED_EMAIL === 'true',
    redisUrl,
    googleClientIds: (env.GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean), // web + iOS + Android client IDs
    firebaseServiceAccountBase64: env.FIREBASE_SERVICE_ACCOUNT_BASE64 || undefined, // base64 of the service-account JSON
    storage: {
      bucket: env.STORAGE_BUCKET || undefined,
      endpoint: env.STORAGE_ENDPOINT || undefined, // set for R2/MinIO; omit for AWS S3
      region: env.STORAGE_REGION ?? 'auto',
      accessKey: env.STORAGE_ACCESS_KEY || undefined,
      secretKey: env.STORAGE_SECRET_KEY || undefined,
      publicBaseUrl: env.STORAGE_PUBLIC_BASE_URL || undefined, // CDN / public bucket URL
    },
  };
}
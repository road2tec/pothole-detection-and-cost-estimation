import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const here = path.dirname(fileURLToPath(import.meta.url));
// server/src/config -> repository root
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

dotenv.config({ path: path.join(REPO_ROOT, 'server', '.env'), quiet: true });

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  COOKIE_SECURE: bool,

  AI_SERVICE_URL: z.string().url().default('http://127.0.0.1:8000'),
  AI_SERVICE_TOKEN: z.string().min(16, 'AI_SERVICE_TOKEN must be at least 16 characters'),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),

  STORAGE_DIR: z.string().default(path.join(REPO_ROOT, 'storage')),
  MAX_IMAGE_MB: z.coerce.number().positive().default(15),
  MAX_VIDEO_MB: z.coerce.number().positive().default(500),
  MAX_FILES_PER_UPLOAD: z.coerce.number().int().positive().default(20),

  WORKER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v !== 'false'),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(2),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(1500),

  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),

  POWERBI_TENANT_ID: z.string().optional(),
  POWERBI_CLIENT_ID: z.string().optional(),
  POWERBI_CLIENT_SECRET: z.string().optional(),
  POWERBI_WORKSPACE_ID: z.string().optional(),
  POWERBI_REPORT_ID: z.string().optional(),
  POWERBI_DATASET_ID: z.string().optional(),
  POWERBI_SECURE_EMBED_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Env = z.infer<typeof schema>;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    // Fail fast with a readable message; never print secret values.
    throw new Error(`Invalid server configuration:\n${issues}\nSee .env.example.`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production (cookies require HTTPS).');
  }
  return { ...env, STORAGE_DIR: path.resolve(env.STORAGE_DIR) };
}

export const env = load();

export const smtpConfigured = Boolean(env.SMTP_HOST && env.SMTP_FROM);

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { buildPotholeMatch, potholeFilterSchema } from '../services/potholeQuery.js';
import { areaComparison, budgetAnalysis, overview, quality, severityBreakdown, trends } from '../analytics/service.js';
import { POWERBI_TABLES, runExportJob } from '../analytics/powerbiExport.js';
import { AnalyticsExportJob, ApiKey } from '../models/Misc.js';
import { getSetting } from '../services/settings.js';
import { sendStoredFile } from '../services/storage.js';
import { audit } from '../services/audit.js';
import { sha256 } from '../services/tokens.js';
import { notFound, unauthorized } from '../utils/errors.js';

export const analyticsRouter = Router();

/** Bearer user (engineer/admin) OR a read-only analytics API key (Power BI scheduled refresh). */
async function userOrApiKey(req: Request, res: Response, next: NextFunction) {
  const key = req.get('x-api-key');
  if (key) {
    const record = await ApiKey.findOne({ keyHash: sha256(key), revokedAt: null });
    if (!record || !record.scopes.includes('analytics:read')) return next(unauthorized('Invalid API key'));
    await ApiKey.updateOne({ _id: record._id }, { lastUsedAt: new Date() });
    return next();
  }
  return authenticate(req, res, (err?: unknown) => {
    if (err) return next(err);
    return requireRole('engineer', 'admin')(req, res, next);
  });
}

// ---------------------------------------------------------------- Power BI data feed
// Defined before the generic authenticate middleware so API-key access works.
let exportInFlight: Promise<unknown> | null = null;

analyticsRouter.get('/powerbi-export/latest/:table', userOrApiKey, async (req, res) => {
  const table = String(req.params.table).replace(/\.csv$/i, '');
  if (!POWERBI_TABLES.includes(table)) throw notFound('Table');
  let latest = await AnalyticsExportJob.findOne({ status: 'completed', includeDemo: false }).sort({ createdAt: -1 }).lean();
  const stale = !latest || Date.now() - new Date(latest.createdAt as any).getTime() > 15 * 60_000;
  if (stale) {
    // Single-flight: concurrent table requests from one refresh share one export run.
    exportInFlight ??= runExportJob({ includeDemo: false, trigger: 'api' }).finally(() => {
      exportInFlight = null;
    });
    await exportInFlight;
    latest = await AnalyticsExportJob.findOne({ status: 'completed', includeDemo: false }).sort({ createdAt: -1 }).lean();
  }
  if (!latest?.directory) throw notFound('Export');
  await sendStoredFile(res, `${latest.directory}/${table}.csv`, `${table}.csv`);
});

analyticsRouter.use(authenticate);

const filterQuery = potholeFilterSchema;

async function scope(req: Request) {
  return buildPotholeMatch(v(req, 'query'), req);
}

analyticsRouter.get('/overview', validate(filterQuery, 'query'), async (req, res) => {
  const target = (await getSetting('budget')).targetAmount;
  res.json(await overview(await scope(req), target));
});

analyticsRouter.get('/severity', validate(filterQuery, 'query'), async (req, res) => {
  res.json(await severityBreakdown(await scope(req)));
});

analyticsRouter.get(
  '/areas',
  validate(filterQuery.extend({ level: z.enum(['road', 'ward', 'locality']).default('locality'), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(200).default(50) }), 'query'),
  async (req, res) => {
    const q = v(req, 'query');
    const rows = await areaComparison(await scope(req), q.level);
    const start = (q.page - 1) * q.limit;
    res.json({ items: rows.slice(start, start + q.limit), total: rows.length, page: q.page, limit: q.limit, pages: Math.max(1, Math.ceil(rows.length / q.limit)) });
  },
);

analyticsRouter.get('/budget', validate(filterQuery, 'query'), async (req, res) => {
  res.json(await budgetAnalysis(await scope(req)));
});

analyticsRouter.get('/trends', validate(filterQuery.extend({ interval: z.enum(['day', 'week', 'month']).default('month') }), 'query'), async (req, res) => {
  res.json({ items: await trends(await scope(req), v(req, 'query').interval) });
});

analyticsRouter.get('/quality', validate(filterQuery, 'query'), async (req, res) => {
  res.json(await quality(await scope(req)));
});

// ---------------------------------------------------------------- export jobs
analyticsRouter.post(
  '/powerbi-export',
  requireRole('engineer', 'admin'),
  validate(z.object({ includeDemo: z.boolean().default(false) })),
  async (req, res) => {
    const job = await runExportJob({ includeDemo: v(req).includeDemo, userId: req.user!.id, trigger: 'manual' });
    await audit(req, 'analytics.powerbi_export', 'AnalyticsExportJob', job._id, { includeDemo: v(req).includeDemo });
    res.status(201).json({ job });
  },
);

analyticsRouter.get('/powerbi-export', requireRole('engineer', 'admin'), async (_req, res) => {
  res.json({ items: await AnalyticsExportJob.find().sort({ createdAt: -1 }).limit(20).populate('requestedBy', 'name').lean() });
});

analyticsRouter.get('/powerbi-export/:jobId/:file', requireRole('engineer', 'admin'), async (req, res) => {
  const job = await AnalyticsExportJob.findById(req.params.jobId).lean();
  if (!job?.directory || job.status !== 'completed') throw notFound('Export');
  const file = String(req.params.file);
  const allowed = [...POWERBI_TABLES.map((t) => `${t}.csv`), 'export-manifest.json'];
  if (!allowed.includes(file)) throw notFound('File');
  if (file.endsWith('.json')) {
    res.json({ createdAt: job.createdAt, includeDemo: job.includeDemo, files: job.files, checks: job.checks });
    return;
  }
  await sendStoredFile(res, `${job.directory}/${file}`, file);
});

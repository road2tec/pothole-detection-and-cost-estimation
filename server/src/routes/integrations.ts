import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { ApiKey, AnalyticsExportJob } from '../models/Misc.js';
import { powerBiConfig, refreshHistory, triggerRefresh, verifyConnection, PowerBiError } from '../integrations/powerbi.js';
import { POWERBI_TABLES } from '../analytics/powerbiExport.js';
import { audit } from '../services/audit.js';
import { randomToken, sha256 } from '../services/tokens.js';
import { AppError, notFound } from '../utils/errors.js';

export const integrationsRouter = Router();
integrationsRouter.use(authenticate);

integrationsRouter.get('/powerbi/status', requireRole('engineer', 'admin'), async (_req, res) => {
  const cfg = powerBiConfig();
  const [verification, latestExport] = await Promise.all([
    verifyConnection(),
    AnalyticsExportJob.findOne({ status: 'completed' }).sort({ createdAt: -1 }).select('createdAt checks files includeDemo').lean(),
  ]);
  res.json({
    mode: cfg.secureEmbedConfigured || cfg.servicePrincipalConfigured ? 'configured' : 'setup-required',
    secureEmbed: { configured: cfg.secureEmbedConfigured, url: cfg.secureEmbedUrl },
    servicePrincipal: {
      configured: cfg.servicePrincipalConfigured,
      datasetConfigured: cfg.datasetConfigured,
      reportConfigured: cfg.reportConfigured,
      verification,
    },
    dataFeed: {
      // Public base the Power Query scripts use; set API_PUBLIC_URL when the server is behind a proxy.
      baseUrl: `${process.env.API_PUBLIC_URL ?? `http://localhost:${env.PORT}`}/api/v1/analytics/powerbi-export/latest`,
      tables: POWERBI_TABLES,
      latestExport,
    },
  });
});

integrationsRouter.get('/powerbi/configuration', requireRole('admin'), async (_req, res) => {
  const keys = await ApiKey.find().sort({ createdAt: -1 }).select('-keyHash').populate('createdBy', 'name').lean();
  res.json({ config: powerBiConfig(), apiKeys: keys });
});

integrationsRouter.post('/powerbi/refresh', requireRole('admin'), async (req, res) => {
  try {
    const result = await triggerRefresh();
    await audit(req, 'powerbi.refresh_requested', 'PowerBI', env.POWERBI_DATASET_ID);
    res.status(202).json(result);
  } catch (err) {
    if (err instanceof PowerBiError) {
      throw new AppError(err.status === 401 || err.status === 403 ? 502 : 409, 'POWERBI_NOT_AVAILABLE', err.message);
    }
    throw err;
  }
});

integrationsRouter.get('/powerbi/refresh', requireRole('engineer', 'admin'), async (_req, res) => {
  try {
    res.json({ items: await refreshHistory() });
  } catch (err) {
    if (err instanceof PowerBiError) throw new AppError(502, 'POWERBI_NOT_AVAILABLE', err.message);
    throw err;
  }
});

integrationsRouter.post('/powerbi/api-keys', requireRole('admin'), validate(z.object({ name: z.string().trim().min(3).max(80) })), async (req, res) => {
  const raw = `pbi_${randomToken(32)}`;
  const key = await ApiKey.create({ name: v(req).name, prefix: raw.slice(0, 10), keyHash: sha256(raw), createdBy: req.user!.id });
  await audit(req, 'powerbi.api_key_create', 'ApiKey', key._id, { name: key.name });
  // The raw key is shown exactly once and never stored.
  res.status(201).json({ id: key._id, name: key.name, prefix: key.prefix, key: raw });
});

integrationsRouter.delete('/powerbi/api-keys/:id', requireRole('admin'), async (req, res) => {
  const key = await ApiKey.findOneAndUpdate({ _id: req.params.id, revokedAt: null }, { revokedAt: new Date() }, { returnDocument: 'after' });
  if (!key) throw notFound('API key');
  await audit(req, 'powerbi.api_key_revoke', 'ApiKey', key._id, { name: key.name });
  res.status(204).end();
});

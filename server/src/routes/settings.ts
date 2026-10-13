import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { CostConfiguration } from '../models/CostConfiguration.js';
import {
  costConfigInput,
  createCostConfigVersion,
  getActiveCostConfig,
  getSetting,
  setSetting,
  settingSchemas,
  type SettingKey,
} from '../services/settings.js';
import { audit } from '../services/audit.js';
import { badRequest } from '../utils/errors.js';

export const settingsRouter = Router();
settingsRouter.use(authenticate);

// Everyone signed in can read the rates and limits that produced the numbers they see.
settingsRouter.get('/cost-rates', async (_req, res) => {
  const [active, history] = await Promise.all([
    getActiveCostConfig(),
    CostConfiguration.find().sort({ version: -1 }).limit(50).populate('changedBy', 'name').lean(),
  ]);
  res.json({ active, history });
});

settingsRouter.put('/cost-rates', requireRole('admin'), validate(costConfigInput), async (req, res) => {
  const { previous, next } = await createCostConfigVersion(v(req), req.user!.id);
  await audit(req, 'settings.cost_rates', 'CostConfiguration', next!._id, {
    previousVersion: previous.version,
    newVersion: next!.version,
    values: v(req),
  });
  res.json({ active: next, note: 'Existing estimates keep their configuration version until recalculated.' });
});

// Severity limits live in the versioned cost configuration (report table cost_config).
settingsRouter.get('/severity', async (_req, res) => {
  const cfg = await getActiveCostConfig();
  res.json({ version: cfg.version, minorMaxM3: cfg.minorMaxM3, severeMinM3: cfg.severeMinM3, depthPlausibilityMaxM: cfg.depthPlausibilityMaxM });
});

const severitySchema = z.object({
  minorMaxM3: z.number().positive().max(10),
  severeMinM3: z.number().positive().max(10),
  depthPlausibilityMaxM: z.number().positive().max(2).optional(),
  note: z.string().trim().max(500).optional(),
});

settingsRouter.put('/severity', requireRole('admin'), validate(severitySchema), async (req, res) => {
  const cfg = await getActiveCostConfig();
  const body = v(req);
  const { previous, next } = await createCostConfigVersion(
    {
      materialPerM3: cfg.materialPerM3,
      labourPerM3: cfg.labourPerM3,
      mobilisationPerVisit: cfg.mobilisationPerVisit,
      minorMaxM3: body.minorMaxM3,
      severeMinM3: body.severeMinM3,
      depthPlausibilityMaxM: body.depthPlausibilityMaxM ?? cfg.depthPlausibilityMaxM ?? 0.5,
      note: body.note,
    },
    req.user!.id,
  );
  await audit(req, 'settings.severity', 'CostConfiguration', next!._id, { previousVersion: previous.version, values: body });
  res.json({ active: next });
});

const KEYS: Record<string, SettingKey> = { model: 'model', processing: 'processing', priority: 'priority', budget: 'budget' };

settingsRouter.get('/:key', async (req, res) => {
  const key = KEYS[String(req.params.key)];
  if (!key) throw badRequest('Unknown setting');
  res.json({ key, value: await getSetting(key) });
});

settingsRouter.put('/:key', requireRole('admin'), async (req, res) => {
  const key = KEYS[String(req.params.key)];
  if (!key) throw badRequest('Unknown setting');
  const parsed = settingSchemas[key].safeParse(req.body);
  if (!parsed.success) {
    throw badRequest('Validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  const before = await getSetting(key);
  try {
    const value = await setSetting(key, parsed.data as any, req.user!.id);
    await audit(req, `settings.${key}`, 'SystemSetting', key, { before, after: value });
    res.json({ key, value });
  } catch (err) {
    if (err instanceof z.ZodError) throw badRequest(err.issues[0]?.message ?? 'Invalid setting');
    throw err;
  }
});

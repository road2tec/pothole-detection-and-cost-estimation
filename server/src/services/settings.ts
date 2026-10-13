import { z } from 'zod';
import { CostConfiguration } from '../models/CostConfiguration.js';
import { SystemSetting } from '../models/SystemSetting.js';
import { validateLimits, validateRates } from './costing.js';

/** Report Table 4.1 — prototype placeholder values, flagged as such everywhere they are shown. */
export const PROTOTYPE_COST_DEFAULTS = {
  currency: 'INR',
  materialPerM3: 25000,
  labourPerM3: 6000,
  mobilisationPerVisit: 500,
  minorMaxM3: 0.005,
  severeMinM3: 0.03,
  depthPlausibilityMaxM: 0.5,
};

export async function getActiveCostConfig() {
  let cfg = await CostConfiguration.findOne({ active: true }).sort({ version: -1 });
  if (!cfg) {
    try {
      cfg = await CostConfiguration.create({
        ...PROTOTYPE_COST_DEFAULTS,
        version: 1,
        active: true,
        isPrototypeDefault: true,
        note: 'Prototype defaults from the preliminary report (Table 4.1). Replace with the local Schedule of Rates.',
      });
    } catch (err) {
      // Another request created version 1 concurrently.
      if ((err as { code?: number }).code !== 11000) throw err;
      cfg = await CostConfiguration.findOne({ active: true }).sort({ version: -1 });
    }
  }
  return cfg!;
}

export const costConfigInput = z.object({
  materialPerM3: z.number().nonnegative().max(10_000_000),
  labourPerM3: z.number().nonnegative().max(10_000_000),
  mobilisationPerVisit: z.number().nonnegative().max(10_000_000),
  minorMaxM3: z.number().positive().max(10),
  severeMinM3: z.number().positive().max(10),
  depthPlausibilityMaxM: z.number().positive().max(2).default(0.5),
  note: z.string().trim().max(500).optional(),
});

export async function createCostConfigVersion(input: z.infer<typeof costConfigInput>, userId: string) {
  validateRates({
    materialPerM3: input.materialPerM3,
    labourPerM3: input.labourPerM3,
    mobilisationPerVisit: input.mobilisationPerVisit,
  });
  validateLimits({ minorMaxM3: input.minorMaxM3, severeMinM3: input.severeMinM3 });
  const current = await getActiveCostConfig();
  const latest = await CostConfiguration.findOne().sort({ version: -1 }).select('version').lean();
  const next = await CostConfiguration.create({
    ...input,
    currency: current.currency,
    version: (latest?.version ?? 0) + 1,
    active: false,
    changedBy: userId,
    validFrom: new Date(),
  });
  // Activate the new version, then deactivate the rest.
  await CostConfiguration.updateOne({ _id: next._id }, { active: true });
  await CostConfiguration.updateMany({ _id: { $ne: next._id }, active: true }, { active: false });
  return { previous: current, next: await CostConfiguration.findById(next._id) };
}

// ---------------------------------------------------------------- key/value settings
export const settingSchemas = {
  model: z.object({
    confidenceThreshold: z.number().min(0.05).max(0.95),
    /** Detections with confidence below this (but above the threshold) are marked "Needs review" (report 3.4.2). */
    reviewConfidenceBelow: z.number().min(0.05).max(0.99),
    includeDepth: z.boolean(),
  }),
  processing: z.object({
    videoSampleFps: z.number().min(0.5).max(30),
    maxVideoDurationSec: z.number().min(5).max(3600),
    maxImageMB: z.number().min(1).max(100),
    maxVideoMB: z.number().min(10).max(4096),
    maxFilesPerUpload: z.number().int().min(1).max(100),
  }),
  priority: z.object({
    severityWeights: z.object({ severe: z.number(), moderate: z.number(), minor: z.number(), unmeasured: z.number() }),
    verifiedBonus: z.number(),
    pendingReviewBonus: z.number(),
    maxAgeBonus: z.number(),
    ageFullAfterDays: z.number().positive(),
    roadImportanceMaxBonus: z.number(),
    validLocationBonus: z.number(),
  }),
  budget: z.object({
    /** Optional approved budget used for "budget variance". Null means no target exists. */
    targetAmount: z.number().nonnegative().max(100_000_000_000).nullable(),
    label: z.string().trim().max(120),
  }),
} as const;

export type SettingKey = keyof typeof settingSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingSchemas)[K]>;

export const SETTING_DEFAULTS: { [K in SettingKey]: SettingValue<K> } = {
  model: { confidenceThreshold: 0.4, reviewConfidenceBelow: 0.6, includeDepth: true },
  processing: { videoSampleFps: 5, maxVideoDurationSec: 600, maxImageMB: 15, maxVideoMB: 500, maxFilesPerUpload: 20 },
  priority: {
    severityWeights: { severe: 50, moderate: 30, minor: 12, unmeasured: 20 },
    verifiedBonus: 10,
    pendingReviewBonus: 4,
    maxAgeBonus: 20,
    ageFullAfterDays: 30,
    roadImportanceMaxBonus: 15,
    validLocationBonus: 5,
  },
  budget: { targetAmount: null, label: '' },
};

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const doc = await SystemSetting.findOne({ key }).lean();
  const merged = { ...SETTING_DEFAULTS[key], ...((doc?.value as object) ?? {}) };
  const parsed = settingSchemas[key].safeParse(merged);
  return (parsed.success ? parsed.data : SETTING_DEFAULTS[key]) as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(key: K, value: SettingValue<K>, userId: string) {
  const parsed = settingSchemas[key].parse(value);
  if (key === 'model') {
    const m = parsed as SettingValue<'model'>;
    if (m.reviewConfidenceBelow < m.confidenceThreshold) {
      throw new z.ZodError([
        { code: 'custom', path: ['reviewConfidenceBelow'], message: 'Must be at least the confidence threshold', input: m },
      ]);
    }
  }
  await SystemSetting.findOneAndUpdate({ key }, { value: parsed, updatedBy: userId }, { upsert: true });
  return parsed;
}

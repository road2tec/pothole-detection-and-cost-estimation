/**
 * Applies the costing engine to pothole records and keeps derived fields consistent:
 * measurement status, volume, calculated severity, per-pothole cost, review flags and priority.
 */
import {
  FORMULA_VERSION,
  MeasurementError,
  classifySeverity,
  computeVolume,
  computeVariableCost,
  type Severity,
} from './costing.js';
import { roundMoney } from '../utils/money.js';
import type { SettingValue } from './settings.js';

export interface CostConfigLike {
  _id: unknown;
  version: number;
  materialPerM3: number;
  labourPerM3: number;
  mobilisationPerVisit: number;
  minorMaxM3: number;
  severeMinM3: number;
  depthPlausibilityMaxM?: number | null;
}

/** Subset of pothole fields this module reads/writes (works on Mongoose docs and plain objects). */
export interface EstimablePothole {
  lengthM?: number | null;
  widthM?: number | null;
  depthM?: number | null;
  volumeM3?: number | null;
  measurementStatus?: string | null;
  measurementFlags?: string[];
  calculatedSeverity?: string | null;
  verifiedSeverity?: string | null;
  severity?: string | null;
  materialCost?: number | null;
  labourCost?: number | null;
  variableCost?: number | null;
  singleVisitMobilisation?: number | null;
  singleVisitTotal?: number | null;
  costConfig?: unknown;
  costConfigVersion?: number | null;
  formulaVersion?: string | null;
  confidence: number;
  needsReview?: boolean;
  reviewReasons?: string[];
  depthSource?: string | null;
  observationCount?: number | null;
  sourceType?: string;
}

const REVIEW_REASON_PREFIXES = ['Low confidence', 'Depth', 'Measurement', 'Single-frame'];

/** Recompute volume, severity and cost from the record's current L/W/D. */
export function applyEstimate(p: EstimablePothole, cfg: CostConfigLike): void {
  const flags = new Set((p.measurementFlags ?? []).filter((f) => f !== 'depth_implausible' && f !== 'invalid_input'));
  const clear = () => {
    p.volumeM3 = null;
    p.calculatedSeverity = null;
    p.materialCost = null;
    p.labourCost = null;
    p.variableCost = null;
    p.singleVisitMobilisation = null;
    p.singleVisitTotal = null;
  };

  const hasLW = isNum(p.lengthM) && isNum(p.widthM);
  const plausibleMax = cfg.depthPlausibilityMaxM ?? 0.5;
  if (isNum(p.depthM) && p.depthM > plausibleMax && p.depthSource !== 'manual') {
    // Report 3.4.2: depth above the plausibility limit is flagged and not used until reviewed.
    flags.add('depth_implausible');
  }

  if (!hasLW) {
    clear();
    p.measurementStatus = 'not_calibrated';
  } else if (!isNum(p.depthM) || flags.has('depth_implausible')) {
    clear();
    p.measurementStatus = 'depth_unavailable';
  } else {
    try {
      const volume = computeVolume({ lengthM: p.lengthM, widthM: p.widthM, depthM: p.depthM })!;
      const rates = {
        materialPerM3: cfg.materialPerM3,
        labourPerM3: cfg.labourPerM3,
        mobilisationPerVisit: cfg.mobilisationPerVisit,
      };
      const c = computeVariableCost(volume, rates);
      p.volumeM3 = volume;
      p.calculatedSeverity = classifySeverity(volume, cfg);
      p.materialCost = c.materialCost;
      p.labourCost = c.labourCost;
      p.variableCost = c.variableCost;
      p.singleVisitMobilisation = roundMoney(cfg.mobilisationPerVisit);
      p.singleVisitTotal = roundMoney(c.variableCost + cfg.mobilisationPerVisit);
      p.measurementStatus = 'complete';
    } catch (err) {
      if (!(err instanceof MeasurementError)) throw err;
      clear();
      flags.add('invalid_input');
      p.measurementStatus = 'invalid';
    }
  }
  p.measurementFlags = [...flags];
  p.severity = (p.verifiedSeverity as Severity | null) ?? (p.calculatedSeverity as Severity | null) ?? null;
  p.costConfig = cfg._id;
  p.costConfigVersion = cfg.version;
  p.formulaVersion = FORMULA_VERSION;
}

/** Automatic review triggers (report 3.4.2). Manual reasons added by people are preserved. */
export function applyReviewFlags(p: EstimablePothole, model: SettingValue<'model'>): void {
  const keep = (p.reviewReasons ?? []).filter((r) => !REVIEW_REASON_PREFIXES.some((x) => r.startsWith(x)));
  const reasons = [...keep];
  if (p.confidence < model.reviewConfidenceBelow) {
    reasons.push(`Low confidence (${p.confidence.toFixed(2)} < ${model.reviewConfidenceBelow})`);
  }
  if (p.measurementFlags?.includes('depth_implausible')) reasons.push('Depth estimate exceeds the plausibility limit');
  if (p.measurementFlags?.includes('invalid_input')) reasons.push('Measurement inputs failed validation');
  if (p.sourceType === 'video' && (p.observationCount ?? 1) < 2) {
    reasons.push('Single-frame video detection (not confirmed across frames)');
  }
  p.reviewReasons = reasons;
  p.needsReview = reasons.length > 0;
}

export interface PriorityInput {
  severity?: string | null;
  verificationStatus?: string;
  detectedAt?: Date | string | null;
  roadImportance?: number | null;
  hasValidLocation?: boolean;
  repairStatus?: string;
}

/**
 * Transparent, configurable priority score. Severity is kept separate; the score only orders work.
 * No traffic, accident or risk data is used because none is recorded by this system.
 */
export function computePriority(
  p: PriorityInput,
  w: SettingValue<'priority'>,
  now: Date = new Date(),
): { score: number; reasons: string[] } {
  if (p.repairStatus === 'repaired') return { score: 0, reasons: ['Repaired — no further action'] };
  if (p.verificationStatus === 'rejected') return { score: 0, reasons: ['Detection rejected by reviewer'] };
  const reasons: string[] = [];
  let score = 0;
  const sevWeight =
    p.severity === 'severe' || p.severity === 'moderate' || p.severity === 'minor'
      ? w.severityWeights[p.severity]
      : w.severityWeights.unmeasured;
  score += sevWeight;
  reasons.push(p.severity ? `Severity ${p.severity} (+${sevWeight})` : `Severity not yet measurable (+${sevWeight})`);
  if (p.verificationStatus === 'verified') {
    score += w.verifiedBonus;
    reasons.push(`Verified by engineer (+${w.verifiedBonus})`);
  } else if (p.verificationStatus === 'pending_review') {
    score += w.pendingReviewBonus;
    reasons.push(`Submitted, awaiting review (+${w.pendingReviewBonus})`);
  }
  if (p.detectedAt) {
    const days = Math.max(0, (now.getTime() - new Date(p.detectedAt).getTime()) / 86_400_000);
    const age = Math.round(Math.min(1, days / w.ageFullAfterDays) * w.maxAgeBonus * 10) / 10;
    if (age > 0) {
      score += age;
      reasons.push(`Reported ${Math.floor(days)} day(s) ago (+${age})`);
    }
  }
  if (isNum(p.roadImportance)) {
    const imp = Math.round(((p.roadImportance - 1) / 4) * w.roadImportanceMaxBonus * 10) / 10;
    if (imp > 0) {
      score += imp;
      reasons.push(`Road importance ${p.roadImportance}/5 (+${imp})`);
    }
  }
  if (p.hasValidLocation) {
    score += w.validLocationBonus;
    reasons.push(`Exact location recorded (+${w.validLocationBonus})`);
  }
  if (p.repairStatus === 'deferred') {
    score = score * 0.5;
    reasons.push('Deferred (score halved)');
  }
  return { score: Math.round(score * 10) / 10, reasons };
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

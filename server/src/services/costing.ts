/**
 * Measurement, severity and repair-cost engine.
 *
 * Formulas follow the preliminary report (section 4.3):
 *   Volume (elliptical bowl):   V = (π / 4) × L × W × D               [m³]
 *   Severity:                   Minor V < V1, Moderate V1 ≤ V < V2, Severe V ≥ V2
 *   Single-visit cost:          C = V × (Cmat + Clab) + Cmob
 *   Visit with n potholes:      C = Σ Vj × (Cmat + Clab) + Cmob       (mobilisation once)
 *
 * Everything here is pure and side-effect free so it can be unit tested in isolation.
 */
import { roundMoney, roundVolume } from '../utils/money.js';

export const FORMULA_VERSION = 'ellipse-bowl-v1';

export type Severity = 'minor' | 'moderate' | 'severe';

export interface Rates {
  materialPerM3: number;
  labourPerM3: number;
  mobilisationPerVisit: number;
}

export interface SeverityLimits {
  /** V1 — volumes below this are Minor. */
  minorMaxM3: number;
  /** V2 — volumes at or above this are Severe. */
  severeMinM3: number;
}

export interface Dimensions {
  lengthM: number | null | undefined;
  widthM: number | null | undefined;
  depthM: number | null | undefined;
}

export class MeasurementError extends Error {}

/** Upper bounds used only to reject obviously impossible inputs (not plausibility warnings). */
export const HARD_LIMITS = { lengthM: 20, widthM: 20, depthM: 2 } as const;

function isUsable(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Validate one dimension: finite, strictly positive and below a hard physical limit. */
export function validateDimension(name: keyof typeof HARD_LIMITS, v: number): void {
  if (!Number.isFinite(v)) throw new MeasurementError(`${name} must be a finite number`);
  if (v <= 0) throw new MeasurementError(`${name} must be greater than zero`);
  if (v > HARD_LIMITS[name]) {
    throw new MeasurementError(`${name} of ${v} m exceeds the ${HARD_LIMITS[name]} m limit`);
  }
}

/**
 * Returns the volume in m³, or null when any dimension is missing.
 * Throws MeasurementError for invalid (negative, zero, infinite, absurd) values.
 */
export function computeVolume(d: Dimensions): number | null {
  if (!isUsable(d.lengthM) || !isUsable(d.widthM) || !isUsable(d.depthM)) {
    if ([d.lengthM, d.widthM, d.depthM].some((v) => typeof v === 'number' && !Number.isFinite(v))) {
      throw new MeasurementError('Dimensions must be finite numbers');
    }
    return null;
  }
  validateDimension('lengthM', d.lengthM);
  validateDimension('widthM', d.widthM);
  validateDimension('depthM', d.depthM);
  return roundVolume((Math.PI / 4) * d.lengthM * d.widthM * d.depthM);
}

export function validateLimits(limits: SeverityLimits): void {
  const { minorMaxM3, severeMinM3 } = limits;
  if (!Number.isFinite(minorMaxM3) || !Number.isFinite(severeMinM3)) {
    throw new MeasurementError('Severity limits must be finite numbers');
  }
  if (minorMaxM3 <= 0 || severeMinM3 <= minorMaxM3) {
    throw new MeasurementError('Severity limits must satisfy 0 < V1 < V2');
  }
}

export function classifySeverity(volumeM3: number, limits: SeverityLimits): Severity {
  validateLimits(limits);
  if (!Number.isFinite(volumeM3) || volumeM3 < 0) {
    throw new MeasurementError('Volume must be a non-negative finite number');
  }
  if (volumeM3 < limits.minorMaxM3) return 'minor';
  if (volumeM3 < limits.severeMinM3) return 'moderate';
  return 'severe';
}

export function validateRates(r: Rates): void {
  // Only the three rate fields are checked, so a full configuration document can be passed.
  for (const k of ['materialPerM3', 'labourPerM3', 'mobilisationPerVisit'] as const) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new MeasurementError(`${k} must be a non-negative number`);
    }
  }
}

export interface VariableCost {
  materialCost: number;
  labourCost: number;
  /** material + labour, excluding mobilisation. */
  variableCost: number;
}

/** Material and labour cost for one pothole. Mobilisation is deliberately excluded. */
export function computeVariableCost(volumeM3: number, rates: Rates): VariableCost {
  validateRates(rates);
  if (!Number.isFinite(volumeM3) || volumeM3 < 0) {
    throw new MeasurementError('Volume must be a non-negative finite number');
  }
  const materialCost = roundMoney(volumeM3 * rates.materialPerM3);
  const labourCost = roundMoney(volumeM3 * rates.labourPerM3);
  return { materialCost, labourCost, variableCost: roundMoney(materialCost + labourCost) };
}

export interface SingleVisitEstimate extends VariableCost {
  mobilisationCost: number;
  totalCost: number;
}

/** C = V × (Cmat + Clab) + Cmob — the cost if this pothole were repaired on its own visit. */
export function estimateSingleVisit(volumeM3: number, rates: Rates): SingleVisitEstimate {
  const v = computeVariableCost(volumeM3, rates);
  const mobilisationCost = roundMoney(rates.mobilisationPerVisit);
  return { ...v, mobilisationCost, totalCost: roundMoney(v.variableCost + mobilisationCost) };
}

export interface VisitEstimate {
  potholeCount: number;
  materialCost: number;
  labourCost: number;
  mobilisationCost: number;
  totalCost: number;
  /** Potholes in the visit with no usable volume; they contribute no variable cost. */
  unmeasuredCount: number;
}

/**
 * Cost of one repair visit covering several potholes.
 * Mobilisation is charged exactly once per visit, never once per pothole.
 */
export function estimateVisit(volumesM3: Array<number | null>, rates: Rates): VisitEstimate {
  validateRates(rates);
  let materialCost = 0;
  let labourCost = 0;
  let unmeasuredCount = 0;
  for (const v of volumesM3) {
    if (v === null) {
      unmeasuredCount += 1;
      continue;
    }
    const c = computeVariableCost(v, rates);
    materialCost += c.materialCost;
    labourCost += c.labourCost;
  }
  materialCost = roundMoney(materialCost);
  labourCost = roundMoney(labourCost);
  const mobilisationCost = volumesM3.length > 0 ? roundMoney(rates.mobilisationPerVisit) : 0;
  return {
    potholeCount: volumesM3.length,
    materialCost,
    labourCost,
    mobilisationCost,
    totalCost: roundMoney(materialCost + labourCost + mobilisationCost),
    unmeasuredCount,
  };
}

export interface FullEstimate {
  volumeM3: number | null;
  severity: Severity | null;
  cost: SingleVisitEstimate | null;
  formulaVersion: string;
}

/** Convenience: dimensions → volume → severity → single-visit cost (nulls when unmeasured). */
export function estimateFromDimensions(
  d: Dimensions,
  rates: Rates,
  limits: SeverityLimits,
): FullEstimate {
  const volumeM3 = computeVolume(d);
  if (volumeM3 === null) return { volumeM3: null, severity: null, cost: null, formulaVersion: FORMULA_VERSION };
  return {
    volumeM3,
    severity: classifySeverity(volumeM3, limits),
    cost: estimateSingleVisit(volumeM3, rates),
    formulaVersion: FORMULA_VERSION,
  };
}

/** Pixel → metre conversion for a reference object: scale = real length / pixel length. */
export function scaleFromReference(referenceLengthM: number, pixelLength: number): number {
  if (!Number.isFinite(referenceLengthM) || referenceLengthM <= 0) {
    throw new MeasurementError('Reference length must be greater than zero');
  }
  if (!Number.isFinite(pixelLength) || pixelLength < 5) {
    throw new MeasurementError('Reference points must be at least 5 pixels apart');
  }
  return referenceLengthM / pixelLength;
}

export function pixelDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

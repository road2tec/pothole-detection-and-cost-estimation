import { describe, expect, it } from 'vitest';
import {
  MeasurementError,
  classifySeverity,
  computeVolume,
  estimateFromDimensions,
  estimateSingleVisit,
  estimateVisit,
  scaleFromReference,
} from '../src/services/costing.js';
import { roundMoney } from '../src/utils/money.js';

const RATES = { materialPerM3: 25000, labourPerM3: 6000, mobilisationPerVisit: 500 };
const LIMITS = { minorMaxM3: 0.005, severeMinM3: 0.03 };

describe('volume (elliptical bowl)', () => {
  it('matches the report worked example (Table 4.2)', () => {
    const v = computeVolume({ lengthM: 0.8, widthM: 0.6, depthM: 0.06 })!;
    expect(v).toBeCloseTo(0.0226, 4);
    expect(classifySeverity(v, LIMITS)).toBe('moderate');
    const c = estimateSingleVisit(v, RATES);
    expect(c.totalCost).toBeCloseTo(1201.2, 1); // report: Rs. 1,201
  });

  it('returns null when any dimension is missing (not zero)', () => {
    expect(computeVolume({ lengthM: 0.8, widthM: 0.6, depthM: null })).toBeNull();
    expect(computeVolume({ lengthM: undefined, widthM: 0.6, depthM: 0.1 })).toBeNull();
  });

  it.each([
    [{ lengthM: -1, widthM: 0.5, depthM: 0.1 }],
    [{ lengthM: 0, widthM: 0.5, depthM: 0.1 }],
    [{ lengthM: 1, widthM: 0.5, depthM: Infinity }],
    [{ lengthM: 1, widthM: Number.NaN, depthM: 0.1 }],
    [{ lengthM: 50, widthM: 0.5, depthM: 0.1 }],
    [{ lengthM: 1, widthM: 0.5, depthM: 3 }],
  ])('rejects invalid input %j', (d) => {
    expect(() => computeVolume(d)).toThrow(MeasurementError);
  });
});

describe('severity boundaries', () => {
  it('classifies at and around V1 and V2', () => {
    expect(classifySeverity(0, LIMITS)).toBe('minor');
    expect(classifySeverity(0.004999, LIMITS)).toBe('minor');
    expect(classifySeverity(0.005, LIMITS)).toBe('moderate'); // V1 ≤ V
    expect(classifySeverity(0.029999, LIMITS)).toBe('moderate');
    expect(classifySeverity(0.03, LIMITS)).toBe('severe'); // V ≥ V2
  });

  it('rejects inconsistent limits', () => {
    expect(() => classifySeverity(0.01, { minorMaxM3: 0.03, severeMinM3: 0.005 })).toThrow(MeasurementError);
    expect(() => classifySeverity(0.01, { minorMaxM3: 0, severeMinM3: 0.005 })).toThrow(MeasurementError);
  });

  it('follows configuration changes', () => {
    expect(classifySeverity(0.01, LIMITS)).toBe('moderate');
    expect(classifySeverity(0.01, { minorMaxM3: 0.02, severeMinM3: 0.05 })).toBe('minor');
  });
});

describe('repair cost', () => {
  it('charges mobilisation once per visit, never per pothole', () => {
    const volumes = [0.01, 0.02, 0.005];
    const visit = estimateVisit(volumes, RATES);
    const variable = volumes.reduce((a, v) => a + v * 31000, 0);
    expect(visit.mobilisationCost).toBe(500);
    expect(visit.totalCost).toBeCloseTo(variable + 500, 2);
    const naive = volumes.reduce((a, v) => a + estimateSingleVisit(v, RATES).totalCost, 0);
    expect(naive - visit.totalCost).toBeCloseTo(1000, 2); // the double counting it avoids
  });

  it('counts unmeasured potholes without inventing a cost', () => {
    const visit = estimateVisit([0.01, null], RATES);
    expect(visit.unmeasuredCount).toBe(1);
    expect(visit.totalCost).toBeCloseTo(0.01 * 31000 + 500, 2);
  });

  it('an empty visit costs nothing', () => {
    expect(estimateVisit([], RATES).totalCost).toBe(0);
  });

  it('accepts a full configuration document as rates', () => {
    const cfgDoc = { _id: 'abc', version: 3, minorMaxM3: 0.005, severeMinM3: 0.03, ...RATES };
    expect(estimateVisit([0.01], cfgDoc as typeof RATES).totalCost).toBeCloseTo(810, 2);
  });

  it('rejects negative rates', () => {
    expect(() => estimateSingleVisit(0.01, { ...RATES, labourPerM3: -1 })).toThrow(MeasurementError);
  });

  it('rounds money to paise consistently', () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(2.675)).toBe(2.68);
    const c = estimateSingleVisit(0.0123457, RATES);
    expect(c.totalCost).toBe(roundMoney(c.materialCost + c.labourCost + c.mobilisationCost));
  });

  it('estimateFromDimensions returns nulls when unmeasured', () => {
    const r = estimateFromDimensions({ lengthM: 0.5, widthM: 0.4, depthM: null }, RATES, LIMITS);
    expect(r).toMatchObject({ volumeM3: null, severity: null, cost: null });
  });
});

describe('reference calibration', () => {
  it('computes metres per pixel', () => {
    expect(scaleFromReference(0.297, 180)).toBeCloseTo(0.00165, 8);
  });
  it('rejects tiny or invalid references', () => {
    expect(() => scaleFromReference(0.3, 2)).toThrow(MeasurementError);
    expect(() => scaleFromReference(0, 200)).toThrow(MeasurementError);
  });
});

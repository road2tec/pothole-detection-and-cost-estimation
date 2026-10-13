import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../src/utils/csv.js';
import { isValidCoordinate, positionAt } from '../src/services/geo.js';
import { applyHomography, bboxDimensionsHomography, measurePothole } from '../src/services/calibration.js';
import { applyEstimate, applyReviewFlags, computePriority } from '../src/services/potholeEstimates.js';
import { SETTING_DEFAULTS } from '../src/services/settings.js';

const CFG = { _id: 'cfg1', version: 1, materialPerM3: 25000, labourPerM3: 6000, mobilisationPerVisit: 500, minorMaxM3: 0.005, severeMinM3: 0.03, depthPlausibilityMaxM: 0.5 };

describe('CSV safety', () => {
  it('neutralises spreadsheet formulas in text cells', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-cmd')).toBe("'-cmd");
  });
  it('keeps numbers numeric, including negatives', () => {
    expect(csvCell(-12.5)).toBe('-12.5');
    expect(csvCell(0)).toBe('0');
    expect(csvCell(Number.NaN)).toBe('');
  });
  it('quotes commas, quotes and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(toCsv(['A'], [[1]])).toBe('﻿A\r\n1\r\n');
  });
});

describe('coordinates and GPX', () => {
  it('rejects invalid and placeholder coordinates', () => {
    expect(isValidCoordinate(18.1, 75.0)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(91, 10)).toBe(false);
    expect(isValidCoordinate(Number.NaN, 10)).toBe(false);
  });
  it('interpolates inside the track and never extrapolates', () => {
    const pts = [
      { lat: 18.0, lon: 75.0, time: 0 },
      { lat: 18.002, lon: 75.002, time: 10_000 },
    ];
    const mid = positionAt(pts, 5_000)!;
    expect(mid.lat).toBeCloseTo(18.001, 9);
    expect(mid.lon).toBeCloseTo(75.001, 9);
    expect(positionAt(pts, -1)).toBeNull();
    expect(positionAt(pts, 10_001)).toBeNull();
    expect(positionAt([{ lat: 1, lon: 1, time: 0 }, { lat: 2, lon: 2, time: 120_000 }], 60_000)).toBeNull(); // gap too long
  });
});

describe('calibration geometry', () => {
  // Homography mapping a 200×200 px square to a 2×2 m square (pure scale).
  const H = [0.01, 0, -1, 0, 0.01, -1, 0, 0, 1];
  it('applies a homography', () => {
    expect(applyHomography(H, { x: 300, y: 300 })).toEqual({ x: 2, y: 2 });
    const d = bboxDimensionsHomography(H, { x1: 150, y1: 150, x2: 250, y2: 200 });
    expect(d.lengthM).toBeCloseTo(1);
    expect(d.widthM).toBeCloseTo(0.5);
  });

  it('never converts without calibration', () => {
    const p: any = { bbox: { x1: 0, y1: 0, x2: 100, y2: 50 }, depthRelative: 0.2 };
    const notes = measurePothole(p, null, null);
    expect(p.lengthM).toBeNull();
    expect(p.depthM).toBeNull();
    expect(notes.join(' ')).toMatch(/relative depth/i);
  });

  it('uses reference scale and prefers mask dimensions', () => {
    const p: any = { bbox: { x1: 0, y1: 0, x2: 100, y2: 50 }, maskLengthPx: 80, maskWidthPx: 40 };
    measurePothole(p, { _id: 'c', metresPerPixel: 0.01 }, null);
    expect(p).toMatchObject({ lengthM: 0.8, widthM: 0.4, dimensionSource: 'mask' });
  });

  it('scales depth only with a fitted alpha and camera height', () => {
    const p: any = { bbox: { x1: 0, y1: 0, x2: 100, y2: 50 }, depthRelative: 0.1 };
    measurePothole(p, { _id: 'c', metresPerPixel: 0.01 }, { method: 'fixed-scale', metresPerPixel: 0.01, depthAlpha: 0.4, cameraHeightM: 1.5 });
    expect(p.depthM).toBeCloseTo(0.06);
    expect(p.depthSource).toBe('model-scaled');
  });

  it('refuses a camera profile calibrated at another resolution', () => {
    const p: any = { bbox: { x1: 0, y1: 0, x2: 100, y2: 50 }, imageWidth: 1280, imageHeight: 720 };
    measurePothole(p, null, { method: 'fixed-scale', metresPerPixel: 0.002, referenceWidthPx: 1920, referenceHeightPx: 1080 });
    expect(p.lengthM).toBeNull();
    expect(p.measurementFlags).toContain('profile_resolution_mismatch');
  });

  it('keeps manual measurements when recalibrating', () => {
    const p: any = { bbox: { x1: 0, y1: 0, x2: 100, y2: 50 }, lengthM: 0.9, widthM: 0.5, dimensionSource: 'manual', depthM: 0.07, depthSource: 'manual' };
    measurePothole(p, { _id: 'c', metresPerPixel: 0.01 }, null);
    expect(p).toMatchObject({ lengthM: 0.9, widthM: 0.5, depthM: 0.07 });
  });
});

describe('pothole estimates', () => {
  it('flags implausible model depth and withholds cost', () => {
    const p: any = { lengthM: 0.8, widthM: 0.6, depthM: 0.7, depthSource: 'model-scaled', confidence: 0.9 };
    applyEstimate(p, CFG);
    expect(p.measurementStatus).toBe('depth_unavailable');
    expect(p.measurementFlags).toContain('depth_implausible');
    expect(p.variableCost).toBeNull();
    applyReviewFlags(p, SETTING_DEFAULTS.model);
    expect(p.needsReview).toBe(true);
  });

  it('marks low-confidence detections for review (report 3.4.2)', () => {
    const p: any = { confidence: 0.45, measurementFlags: [] };
    applyReviewFlags(p, SETTING_DEFAULTS.model);
    expect(p.reviewReasons[0]).toMatch(/Low confidence/);
  });

  it('keeps the calculated severity when a reviewer overrides', () => {
    const p: any = { lengthM: 0.8, widthM: 0.6, depthM: 0.06, confidence: 0.9, verifiedSeverity: 'severe' };
    applyEstimate(p, CFG);
    expect(p.calculatedSeverity).toBe('moderate');
    expect(p.severity).toBe('severe');
  });

  it('records the cost configuration version used', () => {
    const p: any = { lengthM: 0.8, widthM: 0.6, depthM: 0.06, confidence: 0.9 };
    applyEstimate(p, { ...CFG, version: 7 });
    expect(p.costConfigVersion).toBe(7);
    expect(p.singleVisitTotal).toBeCloseTo(1201.2, 1);
  });

  it('explains every priority component', () => {
    const r = computePriority(
      { severity: 'severe', verificationStatus: 'verified', detectedAt: new Date(Date.now() - 15 * 86_400_000), roadImportance: 5, hasValidLocation: true, repairStatus: 'reported' },
      SETTING_DEFAULTS.priority,
    );
    expect(r.score).toBe(50 + 10 + 10 + 15 + 5);
    expect(r.reasons).toHaveLength(5);
    expect(computePriority({ repairStatus: 'repaired' }, SETTING_DEFAULTS.priority).score).toBe(0);
  });
});

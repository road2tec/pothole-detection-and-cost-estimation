/**
 * Converts stored pixel measurements into metres using whichever calibration applies to an upload:
 *   1. a reference-object calibration made on that image (preferred), or
 *   2. a saved camera profile (fixed scale or homography) whose reference resolution matches.
 * Depth in metres is produced only when the camera profile has a fitted depth factor (alpha) and
 * camera height (report Eq. 4.6). Manually entered values are never overwritten.
 */
import { pixelDistance, scaleFromReference } from './costing.js';

export interface Point {
  x: number;
  y: number;
}

export interface ProfileLike {
  _id?: unknown;
  method: 'fixed-scale' | 'homography' | string;
  metresPerPixel?: number | null;
  referenceWidthPx?: number | null;
  referenceHeightPx?: number | null;
  homography?: number[] | null;
  cameraHeightM?: number | null;
  depthAlpha?: number | null;
  active?: boolean | null;
}

export interface CalibrationLike {
  _id?: unknown;
  metresPerPixel: number;
  imageWidth?: number | null;
  imageHeight?: number | null;
}

export interface MeasurablePothole {
  bbox: { x1: number; y1: number; x2: number; y2: number };
  imageWidth?: number | null;
  imageHeight?: number | null;
  maskLengthPx?: number | null;
  maskWidthPx?: number | null;
  depthRelative?: number | null;
  lengthM?: number | null;
  widthM?: number | null;
  depthM?: number | null;
  dimensionSource?: string | null;
  depthSource?: string | null;
  metresPerPixel?: number | null;
  calibration?: unknown;
  measurementFlags?: string[];
}

export function referenceScale(referenceLengthM: number, p1: Point, p2: Point) {
  const pixelLength = pixelDistance(p1, p2);
  return { pixelLength, metresPerPixel: scaleFromReference(referenceLengthM, pixelLength) };
}

export function applyHomography(h: number[], p: Point): Point {
  const [a, b, c, d, e, f, g, hh, i] = h;
  const w = g * p.x + hh * p.y + i;
  if (Math.abs(w) < 1e-12) throw new Error('Point maps to infinity');
  return { x: (a * p.x + b * p.y + c) / w, y: (d * p.x + e * p.y + f) / w };
}

export function bboxDimensionsHomography(h: number[], bbox: MeasurablePothole['bbox']) {
  const tl = applyHomography(h, { x: bbox.x1, y: bbox.y1 });
  const tr = applyHomography(h, { x: bbox.x2, y: bbox.y1 });
  const br = applyHomography(h, { x: bbox.x2, y: bbox.y2 });
  const bl = applyHomography(h, { x: bbox.x1, y: bbox.y2 });
  const a = (pixelDistance(tl, tr) + pixelDistance(bl, br)) / 2;
  const b = (pixelDistance(tl, bl) + pixelDistance(tr, br)) / 2;
  return { lengthM: Math.max(a, b), widthM: Math.min(a, b) };
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

export function profileMatchesResolution(profile: ProfileLike, width?: number | null, height?: number | null): boolean {
  if (!profile.referenceWidthPx || !profile.referenceHeightPx) return true;
  return profile.referenceWidthPx === width && profile.referenceHeightPx === height;
}

/**
 * Sets lengthM/widthM/dimensionSource and depthM/depthSource on the pothole (in place).
 * Returns a list of human-readable limitations for display.
 */
export function measurePothole(
  p: MeasurablePothole,
  calibration: CalibrationLike | null,
  profile: ProfileLike | null,
): string[] {
  const notes: string[] = [];
  const flags = new Set((p.measurementFlags ?? []).filter((f) => f !== 'profile_resolution_mismatch'));
  const manualDims = p.dimensionSource === 'manual';
  const manualDepth = p.depthSource === 'manual';
  const bw = p.bbox.x2 - p.bbox.x1;
  const bh = p.bbox.y2 - p.bbox.y1;
  const lengthPx = p.maskLengthPx ?? Math.max(bw, bh);
  const widthPx = p.maskWidthPx ?? Math.min(bw, bh);
  const pixelSource = p.maskLengthPx ? 'mask' : 'bbox';

  if (!manualDims) {
    p.lengthM = null;
    p.widthM = null;
    p.dimensionSource = null;
    p.metresPerPixel = null;
    p.calibration = null;
    if (calibration) {
      p.lengthM = round4(lengthPx * calibration.metresPerPixel);
      p.widthM = round4(widthPx * calibration.metresPerPixel);
      p.dimensionSource = pixelSource;
      p.metresPerPixel = calibration.metresPerPixel;
      p.calibration = calibration._id;
      notes.push('Scale from a reference object is valid only near the reference plane and distance.');
    } else if (profile && profile.active !== false) {
      if (!profileMatchesResolution(profile, p.imageWidth, p.imageHeight)) {
        flags.add('profile_resolution_mismatch');
        notes.push('Camera profile was calibrated at a different resolution; dimensions not computed.');
      } else if (profile.method === 'homography' && profile.homography?.length === 9) {
        const d = bboxDimensionsHomography(profile.homography, p.bbox);
        p.lengthM = round4(d.lengthM);
        p.widthM = round4(d.widthM);
        p.dimensionSource = 'homography';
        notes.push('Homography assumes a flat road; the bounding box corners are mapped, not the outline.');
      } else if (profile.method === 'fixed-scale' && profile.metresPerPixel) {
        p.lengthM = round4(lengthPx * profile.metresPerPixel);
        p.widthM = round4(widthPx * profile.metresPerPixel);
        p.dimensionSource = pixelSource;
        p.metresPerPixel = profile.metresPerPixel;
      }
    }
  }

  if (!manualDepth) {
    p.depthM = null;
    p.depthSource = null;
    const alpha = profile?.depthAlpha;
    const z = profile?.cameraHeightM;
    if (typeof p.depthRelative === 'number' && p.depthRelative > 0 && alpha && z) {
      p.depthM = round4(alpha * p.depthRelative * z);
      p.depthSource = 'model-scaled';
    } else if (typeof p.depthRelative === 'number' && p.depthRelative > 0) {
      notes.push('Only relative depth is available. Enter a measured depth or use a camera profile with a fitted depth factor.');
    }
  }
  p.measurementFlags = [...flags];
  return notes;
}

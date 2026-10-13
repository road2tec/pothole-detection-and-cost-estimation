import fsp from 'node:fs/promises';
import exifr from 'exifr';
import { XMLParser } from 'fast-xml-parser';

export interface ExifInfo {
  lat?: number;
  lon?: number;
  capturedAt?: Date;
  width?: number;
  height?: number;
}

export function isValidCoordinate(lat: unknown, lon: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    // (0, 0) is almost always a missing-fix placeholder written by cameras.
    !(lat === 0 && lon === 0)
  );
}

/** Read GPS position and capture time from EXIF. Invalid or missing values are omitted, never guessed. */
export async function readExif(file: string): Promise<ExifInfo> {
  try {
    const data = await exifr.parse(file, { gps: true, tiff: true, exif: true, pick: undefined });
    if (!data) return {};
    const out: ExifInfo = {};
    if (isValidCoordinate(data.latitude, data.longitude)) {
      out.lat = data.latitude;
      out.lon = data.longitude;
    }
    const when = data.DateTimeOriginal ?? data.CreateDate;
    if (when instanceof Date && !Number.isNaN(when.getTime())) out.capturedAt = when;
    if (typeof data.ExifImageWidth === 'number') out.width = data.ExifImageWidth;
    if (typeof data.ExifImageHeight === 'number') out.height = data.ExifImageHeight;
    return out;
  } catch {
    return {};
  }
}

export interface GpxPoint {
  lat: number;
  lon: number;
  time: number; // epoch ms
}

/** Parse <trkpt lat lon><time/></trkpt> points. Points without a valid time or position are dropped. */
export async function parseGpx(file: string): Promise<GpxPoint[]> {
  const xml = await fsp.readFile(file, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', processEntities: false });
  const doc = parser.parse(xml);
  const pts: GpxPoint[] = [];
  const asArray = <T>(x: T | T[] | undefined): T[] => (x === undefined ? [] : Array.isArray(x) ? x : [x]);
  for (const trk of asArray(doc?.gpx?.trk)) {
    for (const seg of asArray((trk as any)?.trkseg)) {
      for (const p of asArray((seg as any)?.trkpt)) {
        const lat = Number((p as any)['@lat']);
        const lon = Number((p as any)['@lon']);
        const time = Date.parse(String((p as any).time ?? ''));
        if (isValidCoordinate(lat, lon) && Number.isFinite(time)) pts.push({ lat, lon, time });
      }
    }
  }
  return pts.sort((a, b) => a.time - b.time);
}

/**
 * Position at a given time by linear interpolation between neighbouring track points.
 * Returns null outside the recorded track (no extrapolation) or across gaps over maxGapMs.
 */
export function positionAt(points: GpxPoint[], timeMs: number, maxGapMs = 30_000): { lat: number; lon: number } | null {
  if (points.length === 0) return null;
  if (timeMs < points[0].time || timeMs > points[points.length - 1].time) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time <= timeMs) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  if (a.time === timeMs) return { lat: a.lat, lon: a.lon };
  if (b.time - a.time > maxGapMs) return null;
  const t = (timeMs - a.time) / (b.time - a.time || 1);
  return { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
}

import type { Request } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { REPAIR_STATUSES, SEVERITIES, VERIFICATION_STATUSES } from '../models/Pothole.js';
import { escapeRegex } from '../utils/pagination.js';

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : undefined))
    .pipe(z.array(z.enum(values)).optional());

const objectId = z.string().regex(/^[a-f0-9]{24}$/);
const isoDate = z
  .string()
  .optional()
  .transform((s) => (s ? new Date(s) : undefined))
  .refine((d) => d === undefined || !Number.isNaN(d.getTime()), 'Invalid date');

/** Shared filter definition used by the pothole list, map, analytics, reports and exports. */
export const potholeFilterSchema = z.object({
  q: z.string().trim().max(100).optional(),
  roadId: objectId.optional(),
  areaId: objectId.optional(),
  road: z.string().trim().max(160).optional(),
  ward: z.string().trim().max(80).optional(),
  locality: z.string().trim().max(160).optional(),
  severity: csv([...SEVERITIES, 'unclassified'] as const),
  verificationStatus: csv(VERIFICATION_STATUSES),
  repairStatus: csv(REPAIR_STATUSES),
  measurementStatus: csv(['not_calibrated', 'depth_unavailable', 'complete', 'invalid'] as const),
  needsReview: z.enum(['true', 'false']).optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  maxConfidence: z.coerce.number().min(0).max(1).optional(),
  from: isoDate,
  to: isoDate,
  uploadId: objectId.optional(),
  hasLocation: z.enum(['true', 'false']).optional(),
  includeRejected: z.enum(['true', 'false']).optional(),
  dataset: z.enum(['live', 'demo', 'all']).default('live'),
});

export type PotholeFilter = z.infer<typeof potholeFilterSchema>;

export function buildPotholeMatch(f: PotholeFilter, req?: Request): Record<string, unknown> {
  const m: Record<string, any> = {};
  if (f.dataset === 'live') m.isDemo = false;
  else if (f.dataset === 'demo') m.isDemo = true;
  // Inspectors only ever see records from their own uploads.
  if (req?.user?.role === 'inspector') m.uploadedBy = new Types.ObjectId(req.user.id);
  if (f.q) {
    const rx = new RegExp(escapeRegex(f.q), 'i');
    m.$or = [{ code: rx }, { roadName: rx }, { locality: rx }, { ward: rx }];
  }
  if (f.roadId) m.road = new Types.ObjectId(f.roadId);
  if (f.areaId) m.area = new Types.ObjectId(f.areaId);
  if (f.road) m.roadName = f.road;
  if (f.ward) m.ward = f.ward;
  if (f.locality) m.locality = f.locality;
  if (f.severity?.length) {
    const named = f.severity.filter((s) => s !== 'unclassified');
    const conds: any[] = [];
    if (named.length) conds.push({ severity: { $in: named } });
    if (f.severity.includes('unclassified')) conds.push({ severity: null });
    m.$and = [...(m.$and ?? []), conds.length === 1 ? conds[0] : { $or: conds }];
  }
  if (f.verificationStatus?.length) m.verificationStatus = { $in: f.verificationStatus };
  else if (f.includeRejected !== 'true') m.verificationStatus = { $ne: 'rejected' };
  if (f.repairStatus?.length) m.repairStatus = { $in: f.repairStatus };
  if (f.measurementStatus?.length) m.measurementStatus = { $in: f.measurementStatus };
  if (f.needsReview) m.needsReview = f.needsReview === 'true';
  if (f.minConfidence !== undefined || f.maxConfidence !== undefined) {
    m.confidence = {};
    if (f.minConfidence !== undefined) m.confidence.$gte = f.minConfidence;
    if (f.maxConfidence !== undefined) m.confidence.$lte = f.maxConfidence;
  }
  if (f.from || f.to) {
    m.detectedAt = {};
    if (f.from) m.detectedAt.$gte = f.from;
    if (f.to) {
      const end = new Date(f.to);
      // A bare date means "through the end of that day".
      if (end.getUTCHours() === 0 && end.getUTCMinutes() === 0) end.setUTCDate(end.getUTCDate() + 1);
      m.detectedAt.$lt = end;
    }
  }
  if (f.uploadId) m.upload = new Types.ObjectId(f.uploadId);
  if (f.hasLocation === 'true') m['location.coordinates.0'] = { $exists: true };
  if (f.hasLocation === 'false') m['location.coordinates.0'] = { $exists: false };
  return m;
}

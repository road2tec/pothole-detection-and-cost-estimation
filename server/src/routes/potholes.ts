import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { Pothole, REPAIR_STATUSES, SEVERITIES, type PotholeDoc } from '../models/Pothole.js';
import { DetectionEvent } from '../models/DetectionEvent.js';
import { Upload } from '../models/Upload.js';
import { RepairVisit } from '../models/RepairVisit.js';
import { buildPotholeMatch, potholeFilterSchema } from '../services/potholeQuery.js';
import { loadContext, recompute, refreshPriority, recomputeUpload } from '../services/potholeService.js';
import { getSetting } from '../services/settings.js';
import { HARD_LIMITS } from '../services/costing.js';
import { isValidCoordinate } from '../services/geo.js';
import { audit } from '../services/audit.js';
import { sendStoredFile } from '../services/storage.js';
import { refreshVisitTotals } from '../services/repairVisits.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { pageMeta, paginationSchema } from '../utils/pagination.js';

export const potholesRouter = Router();
potholesRouter.use(authenticate);

const SORTS: Record<string, Record<string, 1 | -1>> = {
  priority: { priorityScore: -1, detectedAt: -1 },
  newest: { detectedAt: -1 },
  oldest: { detectedAt: 1 },
  confidence: { confidence: -1 },
  volume: { volumeM3: -1 },
  cost: { variableCost: -1 },
};

const listQuery = potholeFilterSchema.extend(paginationSchema.shape).extend({
  sort: z.enum(Object.keys(SORTS) as [string, ...string[]]).default('priority'),
});

const LIST_FIELDS =
  'code upload sourceType trackId confidence modelVersion detectedAt roadName ward locality location locationSource ' +
  'lengthM widthM depthM volumeM3 dimensionSource depthSource measurementStatus measurementFlags calculatedSeverity ' +
  'verifiedSeverity severity materialCost labourCost variableCost singleVisitTotal verificationStatus needsReview ' +
  'reviewReasons repairStatus repairVisit actualRepairCost priorityScore priorityReasons isDemo inspectorFlag observationCount';

potholesRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const q = v(req, 'query');
  const match = buildPotholeMatch(q, req);
  const [items, total] = await Promise.all([
    Pothole.find(match).select(LIST_FIELDS).sort(SORTS[q.sort]).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Pothole.countDocuments(match),
  ]);
  res.json({ items, ...pageMeta(q, total) });
});

/** Lightweight points for the map. Only records with real coordinates are returned. */
potholesRouter.get('/map', validate(potholeFilterSchema, 'query'), async (req, res) => {
  const q = v(req, 'query');
  const match = { ...buildPotholeMatch(q, req), 'location.coordinates.0': { $exists: true } };
  const [items, withoutLocation] = await Promise.all([
    Pothole.find(match)
      .select('code location severity repairStatus verificationStatus roadName locality ward confidence volumeM3 variableCost singleVisitTotal measurementStatus locationSource locationVerified isDemo')
      .limit(10000)
      .lean(),
    Pothole.countDocuments({ ...buildPotholeMatch(q, req), 'location.coordinates.0': { $exists: false } }),
  ]);
  res.json({ items, withoutLocation, truncated: items.length === 10000 });
});

async function loadAuthorised(req: Request): Promise<PotholeDoc> {
  const p = await Pothole.findById(req.params.id);
  if (!p) throw notFound('Pothole');
  if (req.user!.role === 'inspector' && String(p.uploadedBy) !== req.user!.id) throw forbidden();
  return p;
}

potholesRouter.get('/:id', async (req, res) => {
  const p = await loadAuthorised(req);
  await p.populate([
    { path: 'upload', select: 'kind originalName storagePath status calibration cameraProfile gps capturedAt createdAt uploadedBy width height', populate: [{ path: 'uploadedBy', select: 'name role' }, { path: 'cameraProfile', select: 'name method depthAlpha cameraHeightM' }] },
    { path: 'calibration', select: 'method referenceLabel referenceLengthM pixelLength metresPerPixel point1 point2 reviewStatus createdAt createdBy' },
    { path: 'reviewedBy', select: 'name role' },
    { path: 'history.by', select: 'name role' },
    { path: 'costConfig', select: 'version materialPerM3 labourPerM3 mobilisationPerVisit minorMaxM3 severeMinM3 isPrototypeDefault depthPlausibilityMaxM' },
    { path: 'repairVisit', select: 'code title status scheduledDate' },
  ]);
  const observations = await DetectionEvent.countDocuments({ pothole: p._id });
  res.json({ pothole: p.toObject(), observations });
});

for (const kind of ['annotated', 'crop', 'frame'] as const) {
  potholesRouter.get(`/:id/${kind}`, async (req, res) => {
    const p = await loadAuthorised(req);
    const rel = kind === 'annotated' ? p.annotatedPath : kind === 'crop' ? p.cropPath : p.framePath;
    await sendStoredFile(res, rel);
  });
}

potholesRouter.get('/:id/observations', async (req, res) => {
  const p = await loadAuthorised(req);
  const items = await DetectionEvent.find({ pothole: p._id }).sort({ frameIndex: 1 }).limit(2000).lean();
  res.json({ items });
});

// ---------------------------------------------------------------- review (engineer / admin)
const reviewSchema = z
  .object({
    decision: z.enum(['verified', 'rejected']),
    verifiedSeverity: z.enum(SEVERITIES).nullable().optional(),
    note: z.string().trim().max(1000).optional(),
  })
  .refine((b) => b.decision !== 'rejected' || (b.note && b.note.length >= 3), {
    message: 'A reason is required when rejecting a detection',
    path: ['note'],
  });

potholesRouter.patch('/:id/review', requireRole('engineer', 'admin'), validate(reviewSchema), async (req, res) => {
  const body = v(req);
  const p = await loadAuthorised(req);
  const before = { verificationStatus: p.verificationStatus, verifiedSeverity: p.verifiedSeverity, severity: p.severity };
  if (body.verifiedSeverity !== undefined && body.verifiedSeverity !== p.calculatedSeverity && !body.note) {
    throw badRequest('A reason is required when the verified severity differs from the calculated severity');
  }
  p.verificationStatus = body.decision;
  if (body.verifiedSeverity !== undefined) p.verifiedSeverity = body.verifiedSeverity;
  // Calculated severity is preserved; the effective severity follows the reviewer.
  p.severity = p.verifiedSeverity ?? p.calculatedSeverity ?? null;
  p.reviewedBy = req.user!.id as any;
  p.reviewedAt = new Date();
  p.reviewNote = body.note;
  p.history.push({ action: `review.${body.decision}`, by: req.user!.id as any, at: new Date(), note: body.note, changes: { before, after: { verificationStatus: p.verificationStatus, verifiedSeverity: p.verifiedSeverity } } } as any);
  refreshPriority(p, await getSetting('priority'));
  await p.save();
  await audit(req, `pothole.review.${body.decision}`, 'Pothole', p._id, { before, verifiedSeverity: p.verifiedSeverity, note: body.note });
  res.json({ pothole: p.toObject() });
});

const flagSchema = z.object({ reason: z.string().trim().min(3).max(500), flagged: z.boolean().default(true) });

potholesRouter.post('/:id/flag', validate(flagSchema), async (req, res) => {
  const { reason, flagged } = v(req);
  const p = await loadAuthorised(req);
  p.inspectorFlag = { flagged, reason, by: req.user!.id as any, at: new Date() } as any;
  const tag = `Flagged as incorrect: ${reason}`;
  p.reviewReasons = (p.reviewReasons ?? []).filter((r) => !r.startsWith('Flagged as incorrect'));
  if (flagged) p.reviewReasons.push(tag);
  p.needsReview = p.reviewReasons.length > 0;
  p.history.push({ action: flagged ? 'flagged' : 'unflagged', by: req.user!.id as any, at: new Date(), note: reason } as any);
  await p.save();
  await audit(req, flagged ? 'pothole.flag' : 'pothole.unflag', 'Pothole', p._id, { reason });
  res.json({ pothole: p.toObject() });
});

// ---------------------------------------------------------------- measurement correction
const dim = (max: number) => z.number().positive().max(max).nullable().optional();
const measurementSchema = z
  .object({
    lengthM: dim(HARD_LIMITS.lengthM),
    widthM: dim(HARD_LIMITS.widthM),
    depthM: dim(HARD_LIMITS.depthM),
    revert: z.array(z.enum(['dimensions', 'depth'])).optional(),
    reason: z.string().trim().min(3, 'A reason is required').max(500),
  })
  .refine((b) => b.lengthM == null || b.widthM == null || b.lengthM >= b.widthM, {
    message: 'Length must be greater than or equal to width',
    path: ['lengthM'],
  });

potholesRouter.patch('/:id/measurements', validate(measurementSchema), async (req, res) => {
  const body = v(req);
  const p = await loadAuthorised(req);
  if (req.user!.role === 'inspector' && (p.verificationStatus === 'verified' || p.verificationStatus === 'rejected')) {
    throw forbidden('Reviewed records can only be corrected by an engineer');
  }
  const before = { lengthM: p.lengthM, widthM: p.widthM, depthM: p.depthM, volumeM3: p.volumeM3, severity: p.calculatedSeverity, dimensionSource: p.dimensionSource, depthSource: p.depthSource };
  const revert = new Set(body.revert ?? []);
  if (revert.has('dimensions')) p.dimensionSource = null;
  if (revert.has('depth')) p.depthSource = null;
  if (body.lengthM !== undefined || body.widthM !== undefined) {
    const L = body.lengthM !== undefined ? body.lengthM : p.lengthM;
    const W = body.widthM !== undefined ? body.widthM : p.widthM;
    if (L == null || W == null) throw badRequest('Provide both length and width');
    if (L < W) throw badRequest('Length must be greater than or equal to width');
    p.lengthM = L;
    p.widthM = W;
    p.dimensionSource = 'manual';
  }
  if (body.depthM !== undefined) {
    p.depthM = body.depthM;
    p.depthSource = body.depthM === null ? null : 'manual';
  }
  const ctx = await loadContext(p.upload);
  recompute(p, ctx);
  p.history.push({ action: 'measurement.corrected', by: req.user!.id as any, at: new Date(), note: body.reason, changes: { before, after: { lengthM: p.lengthM, widthM: p.widthM, depthM: p.depthM, volumeM3: p.volumeM3, severity: p.calculatedSeverity } } } as any);
  await p.save();
  if (p.repairVisit) await refreshVisitTotals(p.repairVisit);
  await audit(req, 'pothole.measurement_correct', 'Pothole', p._id, { before, reason: body.reason });
  res.json({ pothole: p.toObject() });
});

// ---------------------------------------------------------------- repair status
const statusSchema = z.object({
  repairStatus: z.enum(REPAIR_STATUSES),
  actualRepairCost: z.number().nonnegative().max(100_000_000).nullable().optional(),
  note: z.string().trim().max(500).optional(),
});

potholesRouter.patch('/:id/status', requireRole('engineer', 'admin'), validate(statusSchema), async (req, res) => {
  const body = v(req);
  const p = await loadAuthorised(req);
  if (p.verificationStatus === 'rejected') throw badRequest('Rejected detections cannot be scheduled for repair');
  const before = { repairStatus: p.repairStatus, actualRepairCost: p.actualRepairCost };
  p.repairStatus = body.repairStatus;
  if (body.actualRepairCost !== undefined) p.actualRepairCost = body.actualRepairCost ?? undefined;
  p.repairedAt = body.repairStatus === 'repaired' ? p.repairedAt ?? new Date() : undefined;
  p.history.push({ action: 'status.changed', by: req.user!.id as any, at: new Date(), note: body.note, changes: { before, after: { repairStatus: p.repairStatus, actualRepairCost: p.actualRepairCost } } } as any);
  refreshPriority(p, await getSetting('priority'));
  await p.save();
  await audit(req, 'pothole.status_change', 'Pothole', p._id, { before, after: body });
  res.json({ pothole: p.toObject() });
});

// ---------------------------------------------------------------- location correction
const locationSchema = z.object({
  lat: z.number().nullable(),
  lon: z.number().nullable(),
  verified: z.boolean().default(true),
  reason: z.string().trim().min(3).max(500),
});

potholesRouter.patch('/:id/location', requireRole('engineer', 'admin'), validate(locationSchema), async (req, res) => {
  const body = v(req);
  const p = await loadAuthorised(req);
  const before = { coordinates: p.location?.coordinates, source: p.locationSource, verified: p.locationVerified };
  if (body.lat === null || body.lon === null) {
    p.set('location', undefined);
    p.locationSource = null;
    p.locationVerified = false;
  } else {
    if (!isValidCoordinate(body.lat, body.lon)) throw badRequest('Invalid coordinates');
    const unchanged = p.location?.coordinates?.[0] === body.lon && p.location?.coordinates?.[1] === body.lat;
    p.location = { type: 'Point', coordinates: [body.lon, body.lat] } as any;
    if (!unchanged) p.locationSource = 'corrected';
    p.locationVerified = body.verified;
  }
  p.history.push({ action: 'location.corrected', by: req.user!.id as any, at: new Date(), note: body.reason, changes: { before } } as any);
  refreshPriority(p, await getSetting('priority'));
  await p.save();
  await audit(req, 'pothole.location_correct', 'Pothole', p._id, { before, after: { lat: body.lat, lon: body.lon }, reason: body.reason });
  res.json({ pothole: p.toObject() });
});

/** Admin: re-estimate open records with the active cost configuration. */
potholesRouter.post('/recalculate', requireRole('admin'), async (req, res) => {
  const uploads = await Pothole.distinct('upload', { repairStatus: { $ne: 'repaired' }, isDemo: false });
  let count = 0;
  for (const u of uploads) count += await recomputeUpload(u);
  const visits = await RepairVisit.find({ status: { $in: ['planned', 'in_progress'] } }).select('_id');
  for (const visit of visits) await refreshVisitTotals(visit._id);
  await audit(req, 'pothole.recalculate_all', 'Pothole', undefined, { potholes: count, uploads: uploads.length });
  res.json({ recalculated: count });
});

export async function uploadOwnerOf(uploadId: unknown) {
  const u = await Upload.findById(uploadId).select('uploadedBy').lean();
  return u ? String(u.uploadedBy) : null;
}

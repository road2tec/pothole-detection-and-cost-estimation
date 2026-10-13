import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { Calibration } from '../models/Calibration.js';
import { CameraProfile } from '../models/CameraProfile.js';
import { Upload } from '../models/Upload.js';
import { Pothole } from '../models/Pothole.js';
import { referenceScale } from '../services/calibration.js';
import { recomputeUpload } from '../services/potholeService.js';
import { aiClient, AiServiceError } from '../integrations/aiClient.js';
import { audit } from '../services/audit.js';
import { canAccessUpload } from './uploads.js';
import { badRequest, forbidden, notFound, unavailable } from '../utils/errors.js';

export const calibrationsRouter = Router();
export const cameraProfilesRouter = Router();
calibrationsRouter.use(authenticate);
cameraProfilesRouter.use(authenticate);

const point = z.object({ x: z.number().min(0).max(20000), y: z.number().min(0).max(20000) });
const objectId = z.string().regex(/^[a-f0-9]{24}$/);

const createSchema = z.object({
  uploadId: objectId,
  referenceLabel: z.string().trim().max(120).optional(),
  referenceLengthM: z.number().positive().max(50),
  point1: point,
  point2: point,
  note: z.string().trim().max(500).optional(),
});

/** Reference-object calibration: two clicked points on an object of known length. */
calibrationsRouter.post('/', validate(createSchema), async (req, res) => {
  const body = v(req);
  const upload = await Upload.findById(body.uploadId);
  if (!upload) throw notFound('Upload');
  if (!canAccessUpload(req, upload)) throw forbidden();
  if (upload.kind !== 'image') throw badRequest('Reference calibration applies to single images');
  if (upload.status !== 'completed') throw badRequest('Calibrate after detection has completed');
  if (upload.width && upload.height) {
    for (const p of [body.point1, body.point2]) {
      if (p.x > upload.width || p.y > upload.height) throw badRequest('Calibration points must lie inside the image');
    }
  }
  const locked = await Pothole.exists({ upload: upload._id, verificationStatus: 'verified' });
  if (locked && req.user!.role === 'inspector') {
    throw forbidden('This upload has verified records; only an engineer can change its calibration');
  }
  const { pixelLength, metresPerPixel } = referenceScale(body.referenceLengthM, body.point1, body.point2);
  const previous = upload.calibration ? await Calibration.findById(upload.calibration) : null;
  const cal = await Calibration.create({
    upload: upload._id,
    method: 'reference-object',
    referenceLabel: body.referenceLabel,
    referenceLengthM: body.referenceLengthM,
    point1: body.point1,
    point2: body.point2,
    pixelLength,
    metresPerPixel,
    imageWidth: upload.width,
    imageHeight: upload.height,
    createdBy: req.user!.id,
    // An engineer's own calibration counts as reviewed.
    reviewStatus: req.user!.role === 'inspector' ? 'pending' : 'approved',
    reviewedBy: req.user!.role === 'inspector' ? undefined : req.user!.id,
    reviewedAt: req.user!.role === 'inspector' ? undefined : new Date(),
    note: body.note,
  });
  if (previous) {
    previous.active = false;
    previous.supersededBy = cal._id;
    await previous.save();
  }
  upload.calibration = cal._id;
  await upload.save();
  const updated = await recomputeUpload(upload._id);
  await audit(req, previous ? 'calibration.replace' : 'calibration.create', 'Calibration', cal._id, {
    upload: String(upload._id),
    metresPerPixel,
    referenceLengthM: body.referenceLengthM,
    pixelLength,
    previous: previous ? String(previous._id) : null,
  });
  res.status(201).json({ calibration: cal, potholesUpdated: updated });
});

calibrationsRouter.get('/', validate(z.object({ uploadId: objectId }), 'query'), async (req, res) => {
  const { uploadId } = v(req, 'query');
  const upload = await Upload.findById(uploadId).select('uploadedBy').lean();
  if (!upload) throw notFound('Upload');
  if (!canAccessUpload(req, upload)) throw forbidden();
  const items = await Calibration.find({ upload: uploadId }).sort({ createdAt: -1 }).populate('createdBy reviewedBy', 'name role').lean();
  res.json({ items });
});

calibrationsRouter.get('/:id', async (req, res) => {
  const cal = await Calibration.findById(req.params.id).populate('createdBy reviewedBy', 'name role').lean();
  if (!cal) throw notFound('Calibration');
  const upload = await Upload.findById(cal.upload).select('uploadedBy').lean();
  if (!upload || !canAccessUpload(req, upload)) throw forbidden();
  res.json({ calibration: cal });
});

const reviewSchema = z.object({ reviewStatus: z.enum(['approved', 'rejected']), note: z.string().trim().max(500).optional() });

calibrationsRouter.patch('/:id/review', requireRole('engineer', 'admin'), validate(reviewSchema), async (req, res) => {
  const body = v(req);
  const cal = await Calibration.findById(req.params.id);
  if (!cal) throw notFound('Calibration');
  cal.reviewStatus = body.reviewStatus;
  cal.reviewedBy = req.user!.id as any;
  cal.reviewedAt = new Date();
  if (body.note) cal.note = body.note;
  if (body.reviewStatus === 'rejected') cal.active = false;
  await cal.save();
  let updated = 0;
  if (body.reviewStatus === 'rejected') {
    // A rejected calibration stops producing dimensions: detections revert to "Not calibrated".
    await Upload.updateOne({ _id: cal.upload, calibration: cal._id }, { $unset: { calibration: 1 } });
    updated = await recomputeUpload(cal.upload);
  }
  await audit(req, `calibration.${body.reviewStatus}`, 'Calibration', cal._id, { note: body.note });
  res.json({ calibration: cal, potholesUpdated: updated });
});

// ---------------------------------------------------------------- camera profiles
cameraProfilesRouter.get('/', async (_req, res) => {
  const items = await CameraProfile.find().sort({ name: 1 }).lean();
  res.json({ items });
});

const profileSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    method: z.enum(['fixed-scale', 'homography']),
    metresPerPixel: z.number().positive().max(1).optional(),
    referenceWidthPx: z.number().int().positive().max(20000).optional(),
    referenceHeightPx: z.number().int().positive().max(20000).optional(),
    imagePoints: z.array(point).length(4).optional(),
    roadPointsM: z.array(z.object({ x: z.number(), y: z.number() })).length(4).optional(),
    cameraHeightM: z.number().positive().max(20).optional(),
    tiltDeg: z.number().min(-90).max(90).optional(),
    focalPx: z.number().positive().optional(),
    depthAlpha: z.number().positive().max(100).optional(),
    depthAlphaNote: z.string().trim().max(500).optional(),
    active: z.boolean().optional(),
  })
  .refine((p) => p.method !== 'fixed-scale' || p.metresPerPixel, { message: 'metresPerPixel is required', path: ['metresPerPixel'] })
  .refine((p) => p.method !== 'homography' || (p.imagePoints && p.roadPointsM), { message: 'Four image points and four road points are required', path: ['imagePoints'] })
  .refine((p) => !p.depthAlpha || p.depthAlphaNote, { message: 'Describe how the depth factor was fitted', path: ['depthAlphaNote'] })
  .refine((p) => !!p.referenceWidthPx === !!p.referenceHeightPx, { message: 'Provide both reference width and height', path: ['referenceWidthPx'] });

async function buildProfile(body: any) {
  const doc: any = { ...body };
  delete doc.imagePoints;
  delete doc.roadPointsM;
  if (body.method === 'homography') {
    try {
      doc.homography = (await aiClient.homography(body.imagePoints, body.roadPointsM)).homography;
    } catch (err) {
      if (err instanceof AiServiceError && err.code === 'INVALID_INPUT') throw badRequest(err.message);
      throw unavailable('The AI service is needed to compute the homography and is not reachable');
    }
    doc.metresPerPixel = undefined;
  } else {
    doc.homography = [];
  }
  return doc;
}

cameraProfilesRouter.post('/', requireRole('admin'), validate(profileSchema), async (req, res) => {
  const doc = await buildProfile(v(req));
  const profile = await CameraProfile.create({ ...doc, createdBy: req.user!.id });
  await audit(req, 'camera_profile.create', 'CameraProfile', profile._id, { name: profile.name, method: profile.method });
  res.status(201).json({ profile });
});

cameraProfilesRouter.put('/:id', requireRole('admin'), validate(profileSchema), async (req, res) => {
  const existing = await CameraProfile.findById(req.params.id);
  if (!existing) throw notFound('Camera profile');
  const before = existing.toObject();
  const doc = await buildProfile(v(req));
  existing.set(doc);
  await existing.save();
  // Re-measure every upload that uses this profile.
  const uploads = await Upload.find({ cameraProfile: existing._id }).select('_id').lean();
  let updated = 0;
  for (const u of uploads) updated += await recomputeUpload(u._id);
  await audit(req, 'camera_profile.update', 'CameraProfile', existing._id, { before, potholesUpdated: updated });
  res.json({ profile: existing, potholesUpdated: updated });
});

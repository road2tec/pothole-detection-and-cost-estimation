import crypto from 'node:crypto';
import path from 'node:path';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { Upload } from '../models/Upload.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { Pothole } from '../models/Pothole.js';
import { CameraProfile } from '../models/CameraProfile.js';
import { enqueueUploadJob } from '../jobs/worker.js';
import { getSetting } from '../services/settings.js';
import { readExif, isValidCoordinate } from '../services/geo.js';
import { resolvePlace } from '../services/places.js';
import { audit, notify } from '../services/audit.js';
import { User } from '../models/User.js';
import {
  IMAGE_MIME,
  VIDEO_MIME,
  moveInto,
  removeQuietly,
  sendStoredFile,
  sha256File,
  sniffType,
  uploadMiddleware,
} from '../services/storage.js';
import { badRequest, forbidden, notFound } from '../utils/errors.js';
import { pageMeta, paginationSchema } from '../utils/pagination.js';

export const uploadsRouter = Router();
uploadsRouter.use(authenticate);

export function canAccessUpload(req: Request, upload: { uploadedBy: unknown }) {
  if (!req.user) return false;
  if (req.user.role === 'admin' || req.user.role === 'engineer') return true;
  return String(upload.uploadedBy) === req.user.id;
}

const optionalNumber = z
  .union([z.string(), z.number()])
  .optional()
  .transform((x) => (x === undefined || x === '' ? undefined : Number(x)))
  .refine((x) => x === undefined || Number.isFinite(x), 'Must be a number');

const uploadFields = z.object({
  roadId: z.string().regex(/^[a-f0-9]{24}$/).optional().or(z.literal('').transform(() => undefined)),
  roadName: z.string().trim().max(160).optional(),
  ward: z.string().trim().max(80).optional(),
  locality: z.string().trim().max(160).optional(),
  lat: optionalNumber,
  lon: optionalNumber,
  cameraProfileId: z.string().regex(/^[a-f0-9]{24}$/).optional().or(z.literal('').transform(() => undefined)),
  capturedAt: z
    .string()
    .optional()
    .transform((x) => (x ? new Date(x) : undefined))
    .refine((d) => d === undefined || !Number.isNaN(d.getTime()), 'Invalid date'),
  gpxOffsetSec: optionalNumber,
  notes: z.string().trim().max(2000).optional(),
});

// Multer's hard limit uses the larger (video) size; per-type limits are enforced after upload.
const multerUpload = uploadMiddleware(env.MAX_VIDEO_MB * 1024 * 1024, env.MAX_FILES_PER_UPLOAD).fields([
  { name: 'files', maxCount: env.MAX_FILES_PER_UPLOAD },
  { name: 'gpx', maxCount: 1 },
]);

uploadsRouter.post('/', requireRole('inspector', 'engineer', 'admin'), multerUpload, async (req, res) => {
  const files = ((req.files as Record<string, Express.Multer.File[]>)?.files ?? []) as Express.Multer.File[];
  const gpxFile = ((req.files as Record<string, Express.Multer.File[]>)?.gpx ?? [])[0];
  const cleanup = () => Promise.all([...files, gpxFile].map((f) => removeQuietly(f?.path)));
  try {
    if (!files.length) throw badRequest('Attach at least one JPG, PNG or MP4 file');
    const parsed = uploadFields.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw badRequest('Validation failed', parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    }
    const body = parsed.data;
    const processing = await getSetting('processing');
    if (files.length > processing.maxFilesPerUpload) throw badRequest(`At most ${processing.maxFilesPerUpload} files per upload`);
    const hasManualGps = body.lat !== undefined || body.lon !== undefined;
    if (hasManualGps && !isValidCoordinate(body.lat, body.lon)) throw badRequest('Latitude/longitude are invalid');
    if (body.cameraProfileId && !(await CameraProfile.exists({ _id: body.cameraProfileId, active: true }))) {
      throw badRequest('Camera profile not found or inactive');
    }

    // Validate every file before storing any of them.
    const checked: Array<{ file: Express.Multer.File; kind: 'image' | 'video'; ext: string }> = [];
    for (const f of files) {
      const sniff = await sniffType(f.path);
      if (IMAGE_MIME.has(f.mimetype) && (sniff === 'jpeg' || sniff === 'png')) {
        if (f.size > processing.maxImageMB * 1024 * 1024) throw badRequest(`${f.originalname} exceeds ${processing.maxImageMB} MB`);
        checked.push({ file: f, kind: 'image', ext: sniff === 'png' ? 'png' : 'jpg' });
      } else if (VIDEO_MIME.has(f.mimetype) && sniff === 'mp4') {
        if (f.size > processing.maxVideoMB * 1024 * 1024) throw badRequest(`${f.originalname} exceeds ${processing.maxVideoMB} MB`);
        checked.push({ file: f, kind: 'video', ext: 'mp4' });
      } else {
        throw badRequest(`${f.originalname}: content does not match a JPG, PNG or MP4 file`);
      }
    }
    if (gpxFile) {
      if ((await sniffType(gpxFile.path)) !== 'xml') throw badRequest('GPX file is not valid XML');
      if (!checked.some((c) => c.kind === 'video')) throw badRequest('A GPX track can only be attached to a video');
      if (gpxFile.size > 20 * 1024 * 1024) throw badRequest('GPX file exceeds 20 MB');
    }

    const place = await resolvePlace(body);
    const month = new Date().toISOString().slice(0, 7);
    const batchId = checked.length > 1 ? crypto.randomUUID() : undefined;
    const gpxPath = gpxFile ? await moveInto(gpxFile.path, `uploads/${month}`, 'gpx') : undefined;
    const created = [];
    for (const c of checked) {
      const exif = c.kind === 'image' ? await readExif(c.file.path) : {};
      const sha256 = await sha256File(c.file.path);
      const storagePathRel = await moveInto(c.file.path, `uploads/${month}`, c.ext);
      const gps = hasManualGps
        ? { lat: body.lat, lon: body.lon, source: 'manual' as const }
        : exif.lat !== undefined
          ? { lat: exif.lat, lon: exif.lon, source: 'exif' as const }
          : undefined;
      const upload = await Upload.create({
        kind: c.kind,
        originalName: path.basename(c.file.originalname).slice(0, 255),
        storagePath: storagePathRel,
        mimeType: c.file.mimetype,
        sizeBytes: c.file.size,
        sha256,
        uploadedBy: req.user!.id,
        ...place,
        gps,
        capturedAt: body.capturedAt ?? exif.capturedAt,
        gpxPath: c.kind === 'video' ? gpxPath : undefined,
        gpxOffsetSec: body.gpxOffsetSec ?? 0,
        cameraProfile: body.cameraProfileId,
        batchId,
        notes: body.notes,
        status: 'queued',
      });
      const job = await enqueueUploadJob(upload._id, c.kind, req.user!.id);
      created.push({ upload, jobId: job._id, gpsSource: gps?.source ?? null });
    }
    await audit(req, 'upload.create', 'Upload', batchId ?? created[0].upload._id, {
      files: created.length,
      kinds: checked.map((c) => c.kind),
    });
    res.status(202).json({
      batchId,
      items: created.map((c) => ({ id: c.upload._id, kind: c.upload.kind, originalName: c.upload.originalName, status: c.upload.status, jobId: c.jobId, gpsSource: c.gpsSource })),
    });
  } catch (err) {
    await cleanup();
    throw err;
  }
});

const listQuery = paginationSchema.extend({
  status: z.enum(['queued', 'processing', 'completed', 'failed']).optional(),
  kind: z.enum(['image', 'video']).optional(),
  mine: z.enum(['true', 'false']).optional(),
  batchId: z.string().uuid().optional(),
});

uploadsRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const q = v(req, 'query');
  const filter: Record<string, unknown> = { isDemo: false };
  if (req.user!.role === 'inspector' || q.mine === 'true') filter.uploadedBy = req.user!.id;
  if (q.status) filter.status = q.status;
  if (q.kind) filter.kind = q.kind;
  if (q.batchId) filter.batchId = q.batchId;
  const [items, total] = await Promise.all([
    Upload.find(filter)
      .sort({ createdAt: -1 })
      .skip((q.page - 1) * q.limit)
      .limit(q.limit)
      .populate('uploadedBy', 'name role')
      .lean(),
    Upload.countDocuments(filter),
  ]);
  const jobs = await ProcessingJob.find({ upload: { $in: items.map((i) => i._id) } })
    .sort({ createdAt: -1 })
    .select('upload status progress stage error attempts')
    .lean();
  const jobByUpload = new Map<string, any>();
  for (const j of jobs) if (!jobByUpload.has(String(j.upload))) jobByUpload.set(String(j.upload), j);
  res.json({ items: items.map((u) => ({ ...u, job: jobByUpload.get(String(u._id)) ?? null })), ...pageMeta(q, total) });
});

async function loadAuthorised(req: Request) {
  const upload = await Upload.findById(req.params.id).populate('uploadedBy', 'name role').populate('cameraProfile', 'name method').lean();
  if (!upload) throw notFound('Upload');
  if (!canAccessUpload(req, { uploadedBy: (upload.uploadedBy as any)?._id ?? upload.uploadedBy })) throw forbidden();
  return upload;
}

uploadsRouter.get('/:id', async (req, res) => {
  const upload = await loadAuthorised(req);
  const [job, potholes] = await Promise.all([
    ProcessingJob.findOne({ upload: upload._id }).sort({ createdAt: -1 }).lean(),
    Pothole.find({ upload: upload._id }).select('-history').sort({ confidence: -1 }).lean(),
  ]);
  res.json({ upload, job, potholes });
});

uploadsRouter.get('/:id/status', async (req, res) => {
  const upload = await loadAuthorised(req);
  const job = await ProcessingJob.findOne({ upload: upload._id }).sort({ createdAt: -1 }).select('status progress stage error errorCode attempts maxAttempts').lean();
  res.json({ status: upload.status, error: upload.error, job });
});

uploadsRouter.post('/:id/retry', async (req, res) => {
  const upload = await loadAuthorised(req);
  if (req.user!.role === 'engineer' && String((upload.uploadedBy as any)?._id) !== req.user!.id) throw forbidden();
  if (upload.status !== 'failed') throw badRequest('Only failed uploads can be retried');
  const job = await ProcessingJob.findOne({ upload: upload._id }).sort({ createdAt: -1 });
  if (job) {
    job.status = 'queued';
    job.attempts = 0;
    job.error = undefined;
    job.errorCode = undefined;
    job.lockedUntil = undefined;
    job.progress = 0;
    job.stage = 'Queued (manual retry)';
    await job.save();
  } else {
    await enqueueUploadJob(upload._id, upload.kind as 'image' | 'video', req.user!.id);
  }
  await Upload.updateOne({ _id: upload._id }, { status: 'queued', error: null });
  await audit(req, 'upload.retry', 'Upload', upload._id);
  res.json({ status: 'queued' });
});

uploadsRouter.post('/:id/submit', async (req, res) => {
  const upload = await loadAuthorised(req);
  if (upload.status !== 'completed') throw badRequest('Results can be submitted once processing has completed');
  const result = await Pothole.updateMany(
    { upload: upload._id, verificationStatus: 'unsubmitted' },
    { verificationStatus: 'pending_review', $push: { history: { action: 'submitted_for_review', by: req.user!.id, at: new Date() } } },
  );
  await Upload.updateOne({ _id: upload._id }, { submittedForReviewAt: new Date() });
  await audit(req, 'upload.submit_for_review', 'Upload', upload._id, { potholes: result.modifiedCount });
  if (result.modifiedCount > 0) {
    const engineers = await User.find({ role: 'engineer', status: 'active' }).select('_id').lean();
    await Promise.all(
      engineers.map((e) =>
        notify(e._id, 'review', 'Detections awaiting review', `${result.modifiedCount} pothole(s) from ${upload.originalName}`, '/app/review'),
      ),
    );
  }
  res.json({ submitted: result.modifiedCount });
});

uploadsRouter.get('/:id/original', async (req, res) => {
  const upload = await loadAuthorised(req);
  await sendStoredFile(res, upload.storagePath);
});

uploadsRouter.get('/:id/annotated', async (req, res) => {
  const upload = await loadAuthorised(req);
  await sendStoredFile(res, upload.annotatedPath);
});

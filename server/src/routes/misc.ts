import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { Area, Road } from '../models/Geo.js';
import { Pothole } from '../models/Pothole.js';
import { Upload } from '../models/Upload.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { AuditLog, ModelEvaluation, Notification } from '../models/Misc.js';
import { aiClient, AiServiceError } from '../integrations/aiClient.js';
import { getSetting } from '../services/settings.js';
import { audit } from '../services/audit.js';
import { badRequest, notFound } from '../utils/errors.js';
import { escapeRegex, pageMeta, paginationSchema } from '../utils/pagination.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/);

// ---------------------------------------------------------------- roads & areas
export const placesRouter = Router();
placesRouter.use(authenticate);

placesRouter.get('/areas', async (_req, res) => {
  res.json({ items: await Area.find().sort({ ward: 1, locality: 1 }).lean() });
});

placesRouter.get('/roads', validate(z.object({ q: z.string().trim().max(100).optional(), areaId: objectId.optional() }), 'query'), async (req, res) => {
  const q = v(req, 'query');
  const filter: Record<string, unknown> = {};
  if (q.q) filter.name = new RegExp(escapeRegex(q.q), 'i');
  if (q.areaId) filter.area = q.areaId;
  res.json({ items: await Road.find(filter).sort({ name: 1 }).limit(500).populate('area', 'locality ward city').lean() });
});

const areaSchema = z.object({
  locality: z.string().trim().min(1).max(160),
  ward: z.string().trim().min(1).max(80),
  city: z.string().trim().max(120).default(''),
  region: z.string().trim().max(120).default(''),
});

placesRouter.post('/areas', requireRole('admin'), validate(areaSchema), async (req, res) => {
  const area = await Area.create(v(req));
  await audit(req, 'area.create', 'Area', area._id, v(req));
  res.status(201).json({ area });
});

placesRouter.put('/areas/:id', requireRole('admin'), validate(areaSchema), async (req, res) => {
  const area = await Area.findByIdAndUpdate(req.params.id, v(req), { returnDocument: 'after', runValidators: true });
  if (!area) throw notFound('Area');
  // Keep denormalised names on potholes consistent with the renamed area.
  await Pothole.updateMany({ area: area._id }, { ward: area.ward, locality: area.locality });
  await audit(req, 'area.update', 'Area', area._id, v(req));
  res.json({ area });
});

const roadSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().max(40).optional(),
  areaId: objectId,
  importance: z.number().int().min(1).max(5).default(3),
});

placesRouter.post('/roads', requireRole('admin'), validate(roadSchema), async (req, res) => {
  const b = v(req);
  if (!(await Area.exists({ _id: b.areaId }))) throw badRequest('Area not found');
  const road = await Road.create({ name: b.name, code: b.code, area: b.areaId, importance: b.importance });
  await audit(req, 'road.create', 'Road', road._id, b);
  res.status(201).json({ road });
});

placesRouter.put('/roads/:id', requireRole('admin'), validate(roadSchema), async (req, res) => {
  const b = v(req);
  const area = await Area.findById(b.areaId);
  if (!area) throw badRequest('Area not found');
  const road = await Road.findByIdAndUpdate(req.params.id, { name: b.name, code: b.code, area: b.areaId, importance: b.importance }, { returnDocument: 'after', runValidators: true });
  if (!road) throw notFound('Road');
  await Pothole.updateMany({ road: road._id }, { roadName: road.name, area: area._id, ward: area.ward, locality: area.locality });
  await audit(req, 'road.update', 'Road', road._id, b);
  res.json({ road });
});

// ---------------------------------------------------------------- AI service status
export const aiRouter = Router();
aiRouter.use(authenticate);

aiRouter.get('/status', async (_req, res) => {
  try {
    const status = await aiClient.modelStatus();
    res.json({ reachable: true, ...status });
  } catch (err) {
    res.json({
      reachable: false,
      error: err instanceof AiServiceError ? err.message : 'AI service status unavailable',
      code: err instanceof AiServiceError ? err.code : 'FAILED',
    });
  }
});

aiRouter.get('/models', async (_req, res) => {
  const [info, evaluations, model] = await Promise.all([
    aiClient.modelInfo().catch((err) => ({ error: err instanceof AiServiceError ? err.message : 'unavailable' })),
    ModelEvaluation.find().sort({ evaluatedAt: -1 }).limit(20).lean(),
    getSetting('model'),
  ]);
  res.json({ info, evaluations, applicationThresholds: model });
});

aiRouter.get('/jobs/:id', async (req, res) => {
  const job = await ProcessingJob.findById(req.params.id).populate('upload', 'originalName uploadedBy kind').lean();
  if (!job) throw notFound('Job');
  const owner = String((job.upload as any)?.uploadedBy ?? '');
  if (req.user!.role === 'inspector' && owner !== req.user!.id) throw notFound('Job');
  res.json({ job });
});

const evalSchema = z.object({
  modelVersion: z.string().min(3).max(200),
  repository: z.string().max(200).optional(),
  checkpoint: z.string().max(200).optional(),
  datasetDescription: z.string().trim().min(10).max(1000),
  imageCount: z.number().int().positive(),
  iouThreshold: z.number().min(0.1).max(0.95).default(0.5),
  confidenceThreshold: z.number().min(0).max(1).optional(),
  precision: z.number().min(0).max(1).optional(),
  recall: z.number().min(0).max(1).optional(),
  mAP50: z.number().min(0).max(1).optional(),
  mAP50_95: z.number().min(0).max(1).optional(),
  notes: z.string().trim().max(2000).optional(),
});

/** Record an evaluation that was actually run (e.g. with ai-service/scripts/evaluate_model.py). */
aiRouter.post('/evaluations', requireRole('admin'), validate(evalSchema), async (req, res) => {
  const ev = await ModelEvaluation.create({ ...v(req), evaluatedBy: req.user!.id });
  await audit(req, 'model.evaluation_recorded', 'ModelEvaluation', ev._id, v(req));
  res.status(201).json({ evaluation: ev });
});

// ---------------------------------------------------------------- processing jobs (admin)
export const jobsRouter = Router();
jobsRouter.use(authenticate, requireRole('admin'));

jobsRouter.get(
  '/',
  validate(paginationSchema.extend({ status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional() }), 'query'),
  async (req, res) => {
    const q = v(req, 'query');
    const filter = q.status ? { status: q.status } : {};
    const [items, total, counts] = await Promise.all([
      ProcessingJob.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit)
        .populate({ path: 'upload', select: 'originalName kind uploadedBy', populate: { path: 'uploadedBy', select: 'name' } })
        .lean(),
      ProcessingJob.countDocuments(filter),
      ProcessingJob.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);
    res.json({ items, counts: Object.fromEntries(counts.map((c) => [c._id, c.n])), ...pageMeta(q, total) });
  },
);

jobsRouter.post('/:id/retry', async (req, res) => {
  const job = await ProcessingJob.findById(req.params.id);
  if (!job) throw notFound('Job');
  if (job.status !== 'failed' && job.status !== 'cancelled') throw badRequest('Only failed or cancelled jobs can be retried');
  job.status = 'queued';
  job.attempts = 0;
  job.error = undefined;
  job.errorCode = undefined;
  job.lockedUntil = undefined;
  job.progress = 0;
  job.stage = 'Queued (admin retry)';
  await job.save();
  await Upload.updateOne({ _id: job.upload }, { status: 'queued', error: null });
  await audit(req, 'job.retry', 'ProcessingJob', job._id);
  res.json({ job });
});

// ---------------------------------------------------------------- notifications
export const notificationsRouter = Router();
notificationsRouter.use(authenticate);

notificationsRouter.get('/', validate(paginationSchema.extend({ unread: z.enum(['true', 'false']).optional() }), 'query'), async (req, res) => {
  const q = v(req, 'query');
  const filter: Record<string, unknown> = { user: req.user!.id };
  if (q.unread === 'true') filter.readAt = null;
  const [items, total, unread] = await Promise.all([
    Notification.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
    Notification.countDocuments(filter),
    Notification.countDocuments({ user: req.user!.id, readAt: null }),
  ]);
  res.json({ items, unread, ...pageMeta(q, total) });
});

notificationsRouter.post('/read', validate(z.object({ ids: z.array(objectId).max(200).optional() })), async (req, res) => {
  const { ids } = v(req);
  const filter: Record<string, unknown> = { user: req.user!.id, readAt: null };
  if (ids?.length) filter._id = { $in: ids };
  const r = await Notification.updateMany(filter, { readAt: new Date() });
  res.json({ updated: r.modifiedCount });
});

// ---------------------------------------------------------------- audit logs (admin)
export const auditRouter = Router();
auditRouter.use(authenticate, requireRole('admin'));

auditRouter.get(
  '/',
  validate(
    paginationSchema.extend({
      action: z.string().max(80).optional(),
      entity: z.string().max(80).optional(),
      userId: objectId.optional(),
      from: z.coerce.date().optional(),
      to: z.coerce.date().optional(),
    }),
    'query',
  ),
  async (req, res) => {
    const q = v(req, 'query');
    const filter: Record<string, any> = {};
    if (q.action) filter.action = new RegExp(`^${escapeRegex(q.action)}`);
    if (q.entity) filter.entity = q.entity;
    if (q.userId) filter.user = q.userId;
    if (q.from || q.to) filter.createdAt = { ...(q.from ? { $gte: q.from } : {}), ...(q.to ? { $lte: q.to } : {}) };
    const [items, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).lean(),
      AuditLog.countDocuments(filter),
    ]);
    res.json({ items, ...pageMeta(q, total) });
  },
);

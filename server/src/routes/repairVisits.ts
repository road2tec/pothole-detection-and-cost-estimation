import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { RepairVisit } from '../models/RepairVisit.js';
import { Pothole } from '../models/Pothole.js';
import { refreshVisitTotals } from '../services/repairVisits.js';
import { audit } from '../services/audit.js';
import { getSetting } from '../services/settings.js';
import { refreshPriority } from '../services/potholeService.js';
import { nextCode } from '../utils/codes.js';
import { badRequest, notFound } from '../utils/errors.js';
import { pageMeta, paginationSchema } from '../utils/pagination.js';

export const repairVisitsRouter = Router();
repairVisitsRouter.use(authenticate, requireRole('engineer', 'admin'));

const objectId = z.string().regex(/^[a-f0-9]{24}$/);

repairVisitsRouter.get(
  '/',
  validate(paginationSchema.extend({ status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional() }), 'query'),
  async (req, res) => {
    const q = v(req, 'query');
    const filter: Record<string, unknown> = { isDemo: false };
    if (q.status) filter.status = q.status;
    const [items, total] = await Promise.all([
      RepairVisit.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('createdBy', 'name').lean(),
      RepairVisit.countDocuments(filter),
    ]);
    res.json({ items, ...pageMeta(q, total) });
  },
);

repairVisitsRouter.get('/:id', async (req, res) => {
  const visit = await RepairVisit.findById(req.params.id)
    .populate('potholes', 'code roadName locality ward severity volumeM3 materialCost labourCost measurementStatus repairStatus confidence')
    .populate('createdBy', 'name')
    .lean();
  if (!visit) throw notFound('Repair visit');
  res.json({ visit });
});

async function assertAssignable(ids: string[], visitId?: unknown) {
  const potholes = await Pothole.find({ _id: { $in: ids } }).select('repairVisit verificationStatus repairStatus isDemo').lean();
  if (potholes.length !== ids.length) throw badRequest('One or more potholes were not found');
  for (const p of potholes) {
    if (p.verificationStatus === 'rejected') throw badRequest('Rejected detections cannot be added to a repair visit');
    if (p.repairStatus === 'repaired') throw badRequest('Repaired potholes cannot be added to a new visit');
    if (p.repairVisit && String(p.repairVisit) !== String(visitId ?? '')) {
      const other = await RepairVisit.findById(p.repairVisit).select('status code').lean();
      if (other && (other.status === 'planned' || other.status === 'in_progress')) {
        throw badRequest(`A pothole is already assigned to open visit ${other.code}`);
      }
    }
  }
  return potholes;
}

const createSchema = z.object({
  title: z.string().trim().min(3).max(160),
  potholeIds: z.array(objectId).min(1).max(500),
  scheduledDate: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
});

repairVisitsRouter.post('/', validate(createSchema), async (req, res) => {
  const body = v(req);
  const ids = [...new Set<string>(body.potholeIds)];
  await assertAssignable(ids);
  const first = await Pothole.findById(ids[0]).select('road area roadName ward locality').lean();
  const [code] = await nextCode('WO');
  const visit = await RepairVisit.create({
    code,
    title: body.title,
    potholes: ids,
    scheduledDate: body.scheduledDate,
    notes: body.notes,
    road: first?.road,
    area: first?.area,
    roadName: first?.roadName,
    ward: first?.ward,
    locality: first?.locality,
    createdBy: req.user!.id,
  });
  await Pothole.updateMany(
    { _id: { $in: ids } },
    { repairVisit: visit._id, repairStatus: 'scheduled', $push: { history: { action: 'scheduled', by: req.user!.id, at: new Date(), note: `Added to ${code}` } } },
  );
  const updated = await refreshVisitTotals(visit._id);
  await audit(req, 'repair_visit.create', 'RepairVisit', visit._id, { potholes: ids.length, total: updated?.totalEstimatedCost });
  res.status(201).json({ visit: updated });
});

const updateSchema = z.object({
  title: z.string().trim().min(3).max(160).optional(),
  status: z.enum(['planned', 'in_progress', 'completed', 'cancelled']).optional(),
  scheduledDate: z.coerce.date().nullable().optional(),
  actualCost: z.number().nonnegative().max(1_000_000_000).nullable().optional(),
  addPotholeIds: z.array(objectId).max(500).optional(),
  removePotholeIds: z.array(objectId).max(500).optional(),
  notes: z.string().trim().max(2000).optional(),
});

repairVisitsRouter.patch('/:id', validate(updateSchema), async (req, res) => {
  const body = v(req);
  const visit = await RepairVisit.findById(req.params.id);
  if (!visit) throw notFound('Repair visit');
  const wasOpen = visit.status === 'planned' || visit.status === 'in_progress';
  if (!wasOpen && (body.addPotholeIds?.length || body.removePotholeIds?.length)) {
    throw badRequest('Potholes cannot be changed on a completed or cancelled visit');
  }
  const before = { status: visit.status, actualCost: visit.actualCost, potholes: visit.potholes.length };
  if (body.addPotholeIds?.length) {
    await assertAssignable(body.addPotholeIds, visit._id);
    const set = new Set(visit.potholes.map(String));
    body.addPotholeIds.forEach((id: string) => set.add(id));
    visit.potholes = [...set] as any;
    await Pothole.updateMany({ _id: { $in: body.addPotholeIds } }, { repairVisit: visit._id, repairStatus: 'scheduled' });
  }
  if (body.removePotholeIds?.length) {
    const remove = new Set<string>(body.removePotholeIds);
    visit.potholes = visit.potholes.filter((p) => !remove.has(String(p))) as any;
    await Pothole.updateMany(
      { _id: { $in: body.removePotholeIds }, repairVisit: visit._id },
      { $unset: { repairVisit: 1 }, repairStatus: 'reported' },
    );
  }
  if (body.title !== undefined) visit.title = body.title;
  if (body.notes !== undefined) visit.notes = body.notes;
  if (body.scheduledDate !== undefined) visit.scheduledDate = body.scheduledDate ?? undefined;
  if (body.actualCost !== undefined) visit.actualCost = body.actualCost ?? undefined;
  await visit.save();
  // Re-estimate while still open, then apply the status change (which may freeze the estimate).
  await refreshVisitTotals(visit._id);
  if (body.status && body.status !== visit.status) {
    await RepairVisit.updateOne(
      { _id: visit._id },
      { status: body.status, completedDate: body.status === 'completed' ? new Date() : undefined },
    );
    const potholeStatus =
      body.status === 'completed' ? 'repaired' : body.status === 'in_progress' ? 'in_progress' : body.status === 'cancelled' ? 'reported' : 'scheduled';
    const ids = (await RepairVisit.findById(visit._id).select('potholes').lean())!.potholes;
    await Pothole.updateMany(
      { _id: { $in: ids } },
      {
        repairStatus: potholeStatus,
        ...(body.status === 'completed' ? { repairedAt: new Date() } : {}),
        ...(body.status === 'cancelled' ? { $unset: { repairVisit: 1 } } : {}),
        $push: { history: { action: 'status.changed', by: req.user!.id, at: new Date(), note: `Visit ${visit.code} ${body.status}` } },
      },
    );
    const weights = await getSetting('priority');
    for (const p of await Pothole.find({ _id: { $in: ids } })) {
      refreshPriority(p, weights);
      await p.save();
    }
  }
  const updated = await RepairVisit.findById(visit._id).lean();
  await audit(req, 'repair_visit.update', 'RepairVisit', visit._id, { before, changes: body });
  res.json({ visit: updated });
});

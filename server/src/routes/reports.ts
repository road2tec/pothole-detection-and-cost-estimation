import fsp from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { Pothole } from '../models/Pothole.js';
import { Report } from '../models/Misc.js';
import { User } from '../models/User.js';
import { buildPotholeMatch, potholeFilterSchema, type PotholeFilter } from '../services/potholeQuery.js';
import { areaComparison, overview, severityBreakdown, budgetAnalysis } from '../analytics/service.js';
import { getActiveCostConfig, getSetting } from '../services/settings.js';
import { aiClient, AiServiceError } from '../integrations/aiClient.js';
import { audit } from '../services/audit.js';
import { sendStoredFile, storagePath } from '../services/storage.js';
import { toCsv } from '../utils/csv.js';
import { forbidden, notFound, unavailable } from '../utils/errors.js';
import { pageMeta, paginationSchema } from '../utils/pagination.js';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

const MAX_PDF_POTHOLES = 500;
const MAX_CSV_ROWS = 50_000;

const reportBody = z.object({
  title: z.string().trim().max(160).optional(),
  filters: potholeFilterSchema.default(() => potholeFilterSchema.parse({})),
});

function describeFilters(f: PotholeFilter) {
  const d = (x?: Date) => (x ? x.toISOString().slice(0, 10) : undefined);
  return {
    dateRange: f.from || f.to ? `${d(f.from) ?? 'start'} to ${d(f.to) ?? 'today'}` : 'All dates',
    road: f.road ?? 'All',
    locality: f.locality ?? 'All',
    ward: f.ward ?? 'All',
  };
}

function snapshot(cfg: any) {
  return {
    version: cfg.version,
    currency: cfg.currency,
    materialPerM3: cfg.materialPerM3,
    labourPerM3: cfg.labourPerM3,
    mobilisationPerVisit: cfg.mobilisationPerVisit,
    minorMaxM3: cfg.minorMaxM3,
    severeMinM3: cfg.severeMinM3,
    depthPlausibilityMaxM: cfg.depthPlausibilityMaxM,
    isPrototypeDefault: cfg.isPrototypeDefault,
  };
}

function potholeNotes(p: any): string[] {
  const notes: string[] = [];
  if (p.measurementStatus === 'not_calibrated') notes.push('Not calibrated: dimensions, volume and cost unavailable.');
  if (p.measurementStatus === 'depth_unavailable') notes.push('Depth unavailable: volume and cost not estimated.');
  if (p.dimensionSource === 'manual') notes.push('Length/width entered manually.');
  if (p.depthSource === 'manual') notes.push('Depth entered manually.');
  if (p.depthSource === 'model-scaled') notes.push('Depth estimated from a monocular model with a fitted scale factor.');
  if (p.needsReview) notes.push(`Needs review: ${(p.reviewReasons ?? []).join('; ')}`);
  if (p.costConfigVersion !== undefined && p.costConfigVersion !== null) notes.push(`Estimated with cost configuration v${p.costConfigVersion}.`);
  if (p.isDemo) notes.push('DEMO record — not an AI detection.');
  return notes;
}

reportsRouter.post('/pdf', validate(reportBody), async (req, res) => {
  const body = v(req);
  const started = Date.now();
  const match = buildPotholeMatch(body.filters, req);
  const [cfg, user, budgetTarget] = await Promise.all([getActiveCostConfig(), User.findById(req.user!.id).select('name role').lean(), getSetting('budget')]);
  const report = await Report.create({
    kind: 'pdf',
    title: body.title || 'Pothole Maintenance Report',
    filters: body.filters,
    generatedBy: req.user!.id,
    costConfig: cfg._id,
    costConfigSnapshot: snapshot(cfg),
    status: 'generating',
  });
  try {
    const [ov, sev, areas, potholes, total] = await Promise.all([
      overview(match, budgetTarget.targetAmount),
      severityBreakdown(match),
      areaComparison(match, 'road'),
      Pothole.find(match).sort({ priorityScore: -1, detectedAt: -1 }).limit(MAX_PDF_POTHOLES).select('-history -maskPolygon').lean(),
      Pothole.countDocuments(match),
    ]);
    const modelVersions = [...new Set(potholes.map((p) => p.modelVersion))];
    const configVersions = [...new Set(potholes.map((p) => p.costConfigVersion).filter((x) => x !== undefined && x !== null))];
    const notes = [
      'Estimated budget = Σ (material + labour) per measured pothole + mobilisation charged once per repair visit (provisional one visit per road for unscheduled potholes).',
      'Potholes without calibration or depth are listed but excluded from cost totals; their cost is unknown, not zero.',
      'Model confidence is the detector\'s score, not a measurement accuracy or probability of damage.',
    ];
    if (configVersions.length > 1 || (configVersions[0] !== undefined && configVersions[0] !== cfg.version)) {
      notes.push(`Records were estimated with cost configuration version(s) ${configVersions.join(', ')}; the active version is ${cfg.version}.`);
    }
    if (total > potholes.length) notes.push(`Register limited to the ${potholes.length} highest-priority of ${total} records; totals cover all ${total}.`);
    if (body.filters.dataset !== 'live') notes.push('Includes clearly labelled demo records.');
    const payload = {
      title: report.title,
      meta: {
        generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC',
        generatedBy: `${user?.name} (${user?.role})`,
        includesDemo: body.filters.dataset !== 'live',
        ...describeFilters(body.filters),
      },
      totals: {
        potholes: ov.counts.unique,
        measured: ov.budget.measuredPotholes,
        unmeasured: ov.counts.unique - ov.budget.measuredPotholes,
        verified: ov.counts.verified,
        repaired: ov.counts.repaired,
        estimatedBudget: ov.budget.estimatedBudget,
        materialCost: ov.budget.materialCost,
        labourCost: ov.budget.labourCost,
        mobilisationCost: ov.budget.mobilisationCost,
        mobilisationNote: `Mobilisation counted for ${ov.budget.visitGroups} repair visit(s), not per pothole.`,
      },
      severity: sev.severity.map((s) => ({ ...s, severity: s.severity === 'unclassified' ? 'Not classified' : s.severity[0].toUpperCase() + s.severity.slice(1) })),
      areas: areas.slice(0, 60).map((a) => ({ ward: a.ward, locality: a.locality, road: a.name, count: a.count, severe: a.severe, estimatedBudget: a.estimatedBudget })),
      costConfig: snapshot(cfg),
      modelVersions,
      notes,
      potholes: potholes.map((p) => ({
        ...p,
        _id: undefined,
        detectedAt: new Date(p.detectedAt as any).toISOString().slice(0, 10),
        lat: p.location?.coordinates?.[1] ?? null,
        lon: p.location?.coordinates?.[0] ?? null,
        notes: potholeNotes(p),
      })),
    };
    const rel = `reports/${new Date().toISOString().slice(0, 7)}/${report._id}.pdf`;
    let rendered;
    try {
      rendered = await aiClient.renderPdf(rel, payload);
    } catch (err) {
      if (err instanceof AiServiceError) throw unavailable('PDF rendering needs the Python service, which is not reachable. CSV reports remain available.');
      throw err;
    }
    report.status = 'ready';
    report.filePath = rel;
    report.sizeBytes = rendered.sizeBytes;
    report.potholeCount = total;
    report.modelVersions = modelVersions;
    report.totals = payload.totals;
    report.durationMs = Date.now() - started;
    await report.save();
    await audit(req, 'report.pdf', 'Report', report._id, { potholes: total, durationMs: report.durationMs });
    res.status(201).json({ report });
  } catch (err) {
    report.status = 'failed';
    report.error = (err as Error).message;
    await report.save();
    throw err;
  }
});

const csvBody = reportBody.extend({ type: z.enum(['potholes', 'areas', 'severity', 'budget']) });

reportsRouter.post('/csv', validate(csvBody), async (req, res) => {
  const body = v(req);
  const started = Date.now();
  const match = buildPotholeMatch(body.filters, req);
  const cfg = await getActiveCostConfig();
  let headers: string[];
  let rows: unknown[][];
  if (body.type === 'potholes') {
    const items = await Pothole.find(match).sort({ detectedAt: -1 }).limit(MAX_CSV_ROWS).select('-history -maskPolygon').lean();
    headers = ['Code', 'Detected at', 'Source', 'Road', 'Ward', 'Locality', 'Latitude', 'Longitude', 'Location source', 'Confidence', 'Model version', 'Length (m)', 'Width (m)', 'Depth (m)', 'Volume (m3)', 'Dimension source', 'Depth source', 'Measurement status', 'Calculated severity', 'Verified severity', 'Severity', 'Material cost (INR)', 'Labour cost (INR)', 'Variable cost (INR)', 'Single-visit total (INR)', 'Cost config version', 'Verification status', 'Needs review', 'Review reasons', 'Repair status', 'Actual repair cost (INR)', 'Priority score', 'Frame detections', 'Demo record'];
    rows = items.map((p) => [p.code, p.detectedAt, p.sourceType, p.roadName, p.ward, p.locality, p.location?.coordinates?.[1], p.location?.coordinates?.[0], p.locationSource, p.confidence, p.modelVersion, p.lengthM, p.widthM, p.depthM, p.volumeM3, p.dimensionSource, p.depthSource, p.measurementStatus, p.calculatedSeverity, p.verifiedSeverity, p.severity, p.materialCost, p.labourCost, p.variableCost, p.singleVisitTotal, p.costConfigVersion, p.verificationStatus, p.needsReview, (p.reviewReasons ?? []).join('; '), p.repairStatus, p.actualRepairCost, p.priorityScore, p.observationCount, p.isDemo]);
  } else if (body.type === 'areas') {
    const items = await areaComparison(match, 'road');
    headers = ['Road', 'Ward', 'Locality', 'Potholes', 'Minor', 'Moderate', 'Severe', 'Not classified', 'Repaired', 'Measured', 'Material (INR)', 'Labour (INR)', 'Mobilisation (INR)', 'Estimated budget (INR)', 'Repair visits counted', 'Max priority'];
    rows = items.map((a) => [a.name, a.ward, a.locality, a.count, a.minor, a.moderate, a.severe, a.unclassified, a.repaired, a.measuredPotholes, a.materialCost, a.labourCost, a.mobilisationCost, a.estimatedBudget, a.visitGroups, a.maxPriority]);
  } else if (body.type === 'severity') {
    const s = await severityBreakdown(match);
    headers = ['Severity', 'Potholes', 'Total volume (m3)', 'Variable cost (INR, excl. mobilisation)'];
    rows = s.severity.map((x) => [x.severity, x.count, x.volumeM3, x.variableCost]);
  } else {
    const b = await budgetAnalysis(match);
    headers = ['Scope', 'Measured potholes', 'Material (INR)', 'Labour (INR)', 'Mobilisation (INR)', 'Estimated budget (INR)', 'Repair visits counted'];
    rows = [
      ['All in scope', b.total.measuredPotholes, b.total.materialCost, b.total.labourCost, b.total.mobilisationCost, b.total.estimatedBudget, b.total.visitGroups],
      ['Unrepaired', b.unrepaired.measuredPotholes, b.unrepaired.materialCost, b.unrepaired.labourCost, b.unrepaired.mobilisationCost, b.unrepaired.estimatedBudget, b.unrepaired.visitGroups],
      ...b.monthly.map((m) => [`Detected ${m.period}`, m.measuredPotholes, m.materialCost, m.labourCost, m.mobilisationCost, m.estimatedBudget, m.visitGroups]),
      ['Recorded actual cost', b.actual.itemsWithActual, null, null, null, b.actual.actual, null],
    ];
  }
  const rel = `reports/${new Date().toISOString().slice(0, 7)}/${body.type}-${Date.now()}.csv`;
  const abs = storagePath(rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const content = toCsv(headers, rows);
  await fsp.writeFile(abs, content, 'utf8');
  const report = await Report.create({
    kind: 'csv',
    csvType: body.type,
    title: body.title || `${body.type[0].toUpperCase()}${body.type.slice(1)} export`,
    filters: body.filters,
    generatedBy: req.user!.id,
    costConfig: cfg._id,
    costConfigSnapshot: snapshot(cfg),
    potholeCount: body.type === 'potholes' ? rows.length : undefined,
    filePath: rel,
    sizeBytes: Buffer.byteLength(content),
    status: 'ready',
    durationMs: Date.now() - started,
  });
  await audit(req, 'report.csv', 'Report', report._id, { type: body.type, rows: rows.length });
  res.status(201).json({ report, rows: rows.length, truncated: body.type === 'potholes' && rows.length === MAX_CSV_ROWS });
});

reportsRouter.get('/history', validate(paginationSchema, 'query'), async (req, res) => {
  const q = v(req, 'query');
  const filter = req.user!.role === 'admin' ? {} : { generatedBy: req.user!.id };
  const [items, total] = await Promise.all([
    Report.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit).populate('generatedBy', 'name role').lean(),
    Report.countDocuments(filter),
  ]);
  res.json({ items, ...pageMeta(q, total) });
});

async function authorisedReport(req: Request) {
  const report = await Report.findById(req.params.id).lean();
  if (!report) throw notFound('Report');
  if (req.user!.role !== 'admin' && String(report.generatedBy) !== req.user!.id) throw forbidden();
  return report;
}

reportsRouter.get('/:id', async (req, res) => {
  res.json({ report: await authorisedReport(req) });
});

reportsRouter.get('/:id/download', async (req, res) => {
  const report = await authorisedReport(req);
  if (report.status !== 'ready') throw notFound('Report file');
  const name = `${(report.title ?? 'report').replace(/\s+/g, '-').toLowerCase()}-${String(report._id).slice(-6)}.${report.kind}`;
  await sendStoredFile(res, report.filePath, name);
});

/**
 * Normalised star-schema export for Power BI (see powerbi/schema/star-schema.md).
 *
 * FactPothole.EstimatedCost is the VARIABLE cost (material + labour) only. Mobilisation lives in
 * FactRepairVisit, one row per repair visit (real work orders plus provisional per-road groups
 * for unscheduled potholes), so DAX can add it once per visit and never per pothole.
 */
import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { Pothole } from '../models/Pothole.js';
import { RepairVisit } from '../models/RepairVisit.js';
import { Area, Road } from '../models/Geo.js';
import { ModelEvaluation } from '../models/Misc.js';
import { AnalyticsExportJob } from '../models/Misc.js';
import { costGroups, sumGroups, overview } from './service.js';
import { buildPotholeMatch, potholeFilterSchema } from '../services/potholeQuery.js';
import { getSetting } from '../services/settings.js';
import { storagePath, toRelative } from '../services/storage.js';
import { toCsv } from '../utils/csv.js';
import { roundMoney } from '../utils/money.js';

export const SEVERITY_KEYS: Record<string, number> = { unclassified: 0, minor: 1, moderate: 2, severe: 3 };
export const STATUS_KEYS: Record<string, number> = { reported: 1, scheduled: 2, in_progress: 3, repaired: 4, deferred: 5 };

const dateKey = (d: Date) => Number(d.toISOString().slice(0, 10).replace(/-/g, ''));
const shortHash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 10);

/** Same grouping key as analytics/service.ts GROUP_KEY, for unscheduled potholes. */
function provisionalKey(p: { road?: unknown; ward?: string | null; locality?: string | null; roadName?: string | null }) {
  const raw = p.road ? `road:${p.road}` : `area:${p.ward ?? '?'}|${p.locality ?? '?'}|${p.roadName ?? '?'}`;
  return { raw, key: `PV-${shortHash(raw)}` };
}

function areaKeyFor(p: { area?: unknown; ward?: string | null; locality?: string | null }) {
  if (p.area) return String(p.area);
  if (!p.ward && !p.locality) return 'AREA-UNKNOWN';
  return `AREA-${shortHash(`${p.ward ?? ''}|${p.locality ?? ''}`)}`;
}

function roadKeyFor(p: { road?: unknown; roadName?: string | null; ward?: string | null; locality?: string | null }) {
  if (p.road) return String(p.road);
  if (!p.roadName) return 'ROAD-UNKNOWN';
  return `ROAD-${shortHash(`${p.roadName}|${p.ward ?? ''}|${p.locality ?? ''}`)}`;
}

export interface ExportResult {
  directory: string;
  files: Array<{ name: string; rows: number; sizeBytes: number }>;
  checks: Record<string, unknown>;
}

export async function buildPowerBiExport(opts: { includeDemo: boolean; outDir: string }): Promise<ExportResult> {
  const filter = potholeFilterSchema.parse({ dataset: opts.includeDemo ? 'all' : 'live' });
  const match = buildPotholeMatch(filter);
  const absDir = storagePath(opts.outDir);
  await fsp.mkdir(absDir, { recursive: true });

  const potholes = await Pothole.find(match)
    .select('code detectedAt reviewedAt repairedAt road area roadName ward locality severity calculatedSeverity verifiedSeverity repairStatus verificationStatus confidence lengthM widthM depthM volumeM3 materialCost labourCost variableCost actualRepairCost measurementStatus repairVisit observationCount modelVersion location priorityScore isDemo sourceType dimensionSource depthSource costConfigVersion')
    .lean();

  const [roads, areas, evaluations, groups, visitsAll] = await Promise.all([
    Road.find().lean(),
    Area.find().lean(),
    ModelEvaluation.find().lean(),
    costGroups(match),
    RepairVisit.find(opts.includeDemo ? {} : { isDemo: false }).lean(),
  ]);
  const visitById = new Map(visitsAll.map((x) => [String(x._id), x]));

  const dimRoad = new Map<string, unknown[]>();
  const dimArea = new Map<string, unknown[]>();
  for (const a of areas) dimArea.set(String(a._id), [String(a._id), a.locality, a.ward, a.city ?? '', a.region ?? '']);
  for (const r of roads) {
    const area = areas.find((a) => String(a._id) === String(r.area));
    dimRoad.set(String(r._id), [String(r._id), r.name, r.code ?? '', String(r.area), area?.ward ?? '', r.importance ?? 3]);
  }
  dimArea.set('AREA-UNKNOWN', ['AREA-UNKNOWN', 'Not recorded', 'Not recorded', '', '']);
  dimRoad.set('ROAD-UNKNOWN', ['ROAD-UNKNOWN', 'Not recorded', '', 'AREA-UNKNOWN', '', 3]);

  let minDate = new Date();
  const factRows: unknown[][] = [];
  const modelVersions = new Set<string>();
  for (const p of potholes) {
    const ak = areaKeyFor(p);
    const rk = roadKeyFor(p);
    if (!dimArea.has(ak)) dimArea.set(ak, [ak, p.locality ?? 'Not recorded', p.ward ?? 'Not recorded', '', '']);
    if (!dimRoad.has(rk)) dimRoad.set(rk, [rk, p.roadName ?? 'Not recorded', '', ak, p.ward ?? '', 3]);
    const measured = typeof p.volumeM3 === 'number';
    // Cost-bearing visit key: only measured potholes carry one (matches analytics/service.ts).
    let visitKey = '';
    if (measured) {
      visitKey = p.repairVisit ? (visitById.get(String(p.repairVisit))?.code ?? String(p.repairVisit)) : provisionalKey(p).key;
    }
    const detected = new Date(p.detectedAt as unknown as string);
    if (detected < minDate) minDate = detected;
    modelVersions.add(p.modelVersion);
    const coords = p.location?.coordinates;
    factRows.push([
      p.code,
      dateKey(detected),
      rk,
      ak,
      SEVERITY_KEYS[p.severity ?? 'unclassified'],
      STATUS_KEYS[p.repairStatus ?? 'reported'],
      p.verificationStatus,
      p.confidence,
      p.lengthM ?? null,
      p.widthM ?? null,
      p.depthM ?? null,
      p.volumeM3 ?? null,
      p.materialCost ?? null,
      p.labourCost ?? null,
      p.variableCost ?? null,
      p.actualRepairCost ?? null,
      p.measurementStatus !== 'not_calibrated',
      measured,
      p.verificationStatus === 'verified',
      true,
      p.observationCount ?? 1,
      visitKey,
      p.repairVisit ? (visitById.get(String(p.repairVisit))?.code ?? '') : '',
      p.modelVersion,
      p.sourceType,
      p.dimensionSource ?? '',
      p.depthSource ?? '',
      p.costConfigVersion ?? null,
      coords?.length === 2 ? coords[1] : null,
      coords?.length === 2 ? coords[0] : null,
      p.priorityScore ?? 0,
      p.isDemo,
      p.reviewedAt && p.verificationStatus === 'verified' ? dateKey(new Date(p.reviewedAt as unknown as string)) : null,
      p.repairedAt && p.repairStatus === 'repaired' ? dateKey(new Date(p.repairedAt as unknown as string)) : null,
    ]);
  }

  // FactRepairVisit: one row per cost group (real visit or provisional), mirroring analytics.
  const visitRows: unknown[][] = groups.map((g) => {
    const real = g.visitId ? visitById.get(g.visitId) : undefined;
    const sample = potholes.find((p) =>
      real ? String(p.repairVisit) === g.visitId : !p.repairVisit && provisionalKey(p).raw === g.key,
    );
    const when = real?.scheduledDate ?? real?.createdAt ?? sample?.detectedAt ?? new Date();
    return [
      real ? real.code : `PV-${shortHash(g.key)}`,
      !real,
      real ? real.status : 'provisional',
      sample ? roadKeyFor(sample) : 'ROAD-UNKNOWN',
      sample ? areaKeyFor(sample) : 'AREA-UNKNOWN',
      dateKey(new Date(when as unknown as string)),
      g.measured,
      g.materialCost,
      g.labourCost,
      g.mobilisationCost,
      roundMoney(g.materialCost + g.labourCost + g.mobilisationCost),
      real?.actualCost ?? null,
    ];
  });

  const dimDate: unknown[][] = [];
  const start = new Date(Date.UTC(minDate.getUTCFullYear(), minDate.getUTCMonth(), 1));
  const end = new Date();
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const m = d.getUTCMonth();
    dimDate.push([
      dateKey(d),
      d.toISOString().slice(0, 10),
      d.getUTCDate(),
      d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }),
      m + 1,
      `Q${Math.floor(m / 3) + 1}`,
      d.getUTCFullYear(),
      `${d.getUTCFullYear()}-${String(m + 1).padStart(2, '0')}`,
    ]);
  }

  const modelRows = [...modelVersions].map((mv) => {
    const ev = evaluations.filter((e) => e.modelVersion === mv).sort((a, b) => +new Date(b.evaluatedAt as any) - +new Date(a.evaluatedAt as any))[0];
    const [repoRev, checkpoint] = mv.split('/').length > 2 ? [mv.split('/').slice(0, 2).join('/'), mv.split('/').slice(2).join('/')] : [mv, ''];
    return [mv, repoRev.split('@')[0], checkpoint, ev?.evaluatedAt ? new Date(ev.evaluatedAt as any).toISOString().slice(0, 10) : '', ev?.precision ?? null, ev?.recall ?? null, ev?.mAP50 ?? null, ev?.mAP50_95 ?? null, ev?.datasetDescription ?? 'Not evaluated'];
  });

  const tables: Array<[string, string[], unknown[][]]> = [
    ['FactPothole', ['PotholeKey', 'DateKey', 'RoadKey', 'AreaKey', 'SeverityKey', 'StatusKey', 'VerificationStatus', 'Confidence', 'LengthM', 'WidthM', 'DepthM', 'VolumeM3', 'MaterialCost', 'LabourCost', 'EstimatedCost', 'ActualCost', 'IsCalibrated', 'IsMeasured', 'IsVerified', 'IsUnique', 'FrameDetections', 'RepairVisitKey', 'AssignedVisitCode', 'ModelVersion', 'SourceType', 'DimensionSource', 'DepthSource', 'CostConfigVersion', 'Latitude', 'Longitude', 'PriorityScore', 'IsDemo', 'VerifiedDateKey', 'RepairedDateKey'], factRows],
    ['FactRepairVisit', ['RepairVisitKey', 'IsProvisional', 'VisitStatus', 'RoadKey', 'AreaKey', 'DateKey', 'MeasuredPotholes', 'MaterialCost', 'LabourCost', 'MobilisationCost', 'TotalEstimatedCost', 'ActualCost'], visitRows],
    ['DimDate', ['DateKey', 'Date', 'Day', 'Month', 'MonthNumber', 'Quarter', 'Year', 'YearMonth'], dimDate],
    ['DimRoad', ['RoadKey', 'RoadName', 'RoadCode', 'AreaKey', 'Ward', 'Importance'], [...dimRoad.values()]],
    ['DimArea', ['AreaKey', 'Locality', 'Ward', 'City', 'Region'], [...dimArea.values()]],
    ['DimSeverity', ['SeverityKey', 'SeverityName', 'SortOrder'], [[0, 'Not classified', 4], [1, 'Minor', 1], [2, 'Moderate', 2], [3, 'Severe', 3]]],
    ['DimStatus', ['StatusKey', 'StatusName', 'SortOrder'], [[1, 'Reported', 1], [2, 'Scheduled', 2], [3, 'In progress', 3], [4, 'Repaired', 4], [5, 'Deferred', 5]]],
    ['DimModelVersion', ['ModelVersion', 'Repository', 'Checkpoint', 'EvaluationDate', 'Precision', 'Recall', 'mAP50', 'mAP50_95', 'EvaluationDataset'], modelRows],
  ];

  const files = [];
  for (const [name, headers, rows] of tables) {
    const file = path.join(absDir, `${name}.csv`);
    await fsp.writeFile(file, toCsv(headers, rows), 'utf8');
    files.push({ name: `${name}.csv`, rows: rows.length, sizeBytes: (await fsp.stat(file)).size });
  }

  // Reconciliation: export totals must equal the live analytics service for the same scope.
  const exportVariable = roundMoney(factRows.reduce((a, r) => a + ((r[14] as number) ?? 0), 0));
  const exportMobilisation = roundMoney(visitRows.reduce((a, r) => a + (r[9] as number), 0));
  const live = sumGroups(groups);
  const ov = await overview(match, (await getSetting('budget')).targetAmount);
  const checks = {
    uniquePotholes: { export: factRows.length, dashboard: ov.counts.unique, ok: factRows.length === ov.counts.unique },
    frameDetections: {
      export: factRows.reduce((a, r) => a + (r[20] as number), 0),
      dashboard: ov.counts.frameDetections,
      ok: factRows.reduce((a, r) => a + (r[20] as number), 0) === ov.counts.frameDetections,
    },
    variableCost: { export: exportVariable, dashboard: live.variableCost, ok: Math.abs(exportVariable - live.variableCost) < 0.01 },
    mobilisationCost: { export: exportMobilisation, dashboard: live.mobilisationCost, ok: Math.abs(exportMobilisation - live.mobilisationCost) < 0.01 },
    estimatedBudget: {
      export: roundMoney(exportVariable + exportMobilisation),
      dashboard: ov.budget.estimatedBudget,
      ok: Math.abs(exportVariable + exportMobilisation - ov.budget.estimatedBudget) < 0.01,
    },
  };
  await fsp.writeFile(path.join(absDir, 'export-manifest.json'), JSON.stringify({ generatedAt: new Date().toISOString(), includeDemo: opts.includeDemo, files, checks }, null, 2));
  return { directory: toRelative(absDir), files, checks };
}

export async function runExportJob(opts: { includeDemo: boolean; userId?: string; trigger: 'manual' | 'cli' | 'api' }) {
  const started = Date.now();
  const job = await AnalyticsExportJob.create({ requestedBy: opts.userId, trigger: opts.trigger, includeDemo: opts.includeDemo });
  try {
    const result = await buildPowerBiExport({ includeDemo: opts.includeDemo, outDir: `exports/powerbi/${job._id}` });
    job.status = 'completed';
    job.directory = result.directory;
    job.files = result.files as any;
    job.checks = result.checks;
    job.durationMs = Date.now() - started;
    await job.save();
    return job;
  } catch (err) {
    job.status = 'failed';
    job.error = (err as Error).message;
    job.durationMs = Date.now() - started;
    await job.save();
    throw err;
  }
}

export const POWERBI_TABLES = ['FactPothole', 'FactRepairVisit', 'DimDate', 'DimRoad', 'DimArea', 'DimSeverity', 'DimStatus', 'DimModelVersion'];

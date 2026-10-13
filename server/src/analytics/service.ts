/**
 * Analytics definitions shared by the React dashboard, PDF/CSV reports and the Power BI export.
 *
 * Definitions (see docs/cost-estimation.md):
 *  - Unique potholes: Pothole records in scope (rejected detections excluded unless requested).
 *  - Frame-level detections: model observations; for images 1 per pothole, for video one per
 *    tracked frame (Σ observationCount, equal to the DetectionEvent count).
 *  - Variable cost: Σ (material + labour) of measured potholes, each at the configuration version
 *    it was estimated with.
 *  - Mobilisation: charged ONCE per repair visit. Potholes already in a visit use that visit's
 *    mobilisation charge. Unscheduled measured potholes are grouped into one provisional visit
 *    per road (or per ward + locality when no road is recorded) at the active rate.
 *  - Estimated budget = variable cost + mobilisation. Unmeasured potholes are counted separately
 *    and contribute nothing (their cost is unknown, not zero).
 */
import { Types } from 'mongoose';
import { Pothole } from '../models/Pothole.js';
import { RepairVisit } from '../models/RepairVisit.js';
import { getActiveCostConfig } from '../services/settings.js';
import { roundMoney } from '../utils/money.js';

type Match = Record<string, unknown>;

export interface CostGroup {
  key: string;
  visitId: string | null;
  roadName: string | null;
  ward: string | null;
  locality: string | null;
  period?: string | null;
  measured: number;
  materialCost: number;
  labourCost: number;
  mobilisationCost: number;
}

const GROUP_KEY = {
  $cond: [
    { $ifNull: ['$repairVisit', false] },
    { $concat: ['visit:', { $toString: '$repairVisit' }] },
    {
      $cond: [
        { $ifNull: ['$road', false] },
        { $concat: ['road:', { $toString: '$road' }] },
        { $concat: ['area:', { $ifNull: ['$ward', '?'] }, '|', { $ifNull: ['$locality', '?'] }, '|', { $ifNull: ['$roadName', '?'] }] },
      ],
    },
  ],
};

const PERIOD_FORMAT: Record<string, string> = { day: '%Y-%m-%d', week: '%G-W%V', month: '%Y-%m' };

/** Visit-level cost groups for measured potholes in scope, optionally split by period. */
export async function costGroups(match: Match, period?: 'day' | 'week' | 'month'): Promise<CostGroup[]> {
  const rows = await Pothole.aggregate([
    { $match: { ...match, volumeM3: { $type: 'number' } } },
    {
      $group: {
        _id: period
          ? { g: GROUP_KEY, p: { $dateToString: { format: PERIOD_FORMAT[period], date: '$detectedAt' } } }
          : { g: GROUP_KEY },
        visitId: { $first: '$repairVisit' },
        roadName: { $first: '$roadName' },
        ward: { $first: '$ward' },
        locality: { $first: '$locality' },
        measured: { $sum: 1 },
        materialCost: { $sum: { $ifNull: ['$materialCost', 0] } },
        labourCost: { $sum: { $ifNull: ['$labourCost', 0] } },
      },
    },
    { $sort: { '_id.p': 1, '_id.g': 1 } },
  ]);
  const cfg = await getActiveCostConfig();
  const visitIds = rows.map((r) => r.visitId).filter(Boolean);
  const visits = visitIds.length
    ? await RepairVisit.find({ _id: { $in: visitIds } }).select('mobilisationCost roadName ward locality').lean()
    : [];
  const visitMap = new Map(visits.map((x) => [String(x._id), x]));
  const seenVisitPeriod = new Set<string>();
  return rows.map((r) => {
    const visit = r.visitId ? visitMap.get(String(r.visitId)) : undefined;
    // In a period split a visit's mobilisation is attributed to the first period it appears in.
    const visitKey = r.visitId ? String(r.visitId) : null;
    let mobilisation = visit ? visit.mobilisationCost ?? cfg.mobilisationPerVisit : cfg.mobilisationPerVisit;
    if (visitKey) {
      if (seenVisitPeriod.has(visitKey)) mobilisation = 0;
      seenVisitPeriod.add(visitKey);
    }
    return {
      key: r._id.g,
      period: r._id.p ?? null,
      visitId: visitKey,
      roadName: visit?.roadName ?? r.roadName ?? null,
      ward: visit?.ward ?? r.ward ?? null,
      locality: visit?.locality ?? r.locality ?? null,
      measured: r.measured,
      materialCost: roundMoney(r.materialCost),
      labourCost: roundMoney(r.labourCost),
      mobilisationCost: roundMoney(mobilisation),
    };
  });
}

export interface BudgetTotals {
  materialCost: number;
  labourCost: number;
  variableCost: number;
  mobilisationCost: number;
  estimatedBudget: number;
  visitGroups: number;
  measuredPotholes: number;
}

export function sumGroups(groups: CostGroup[]): BudgetTotals {
  const t = groups.reduce(
    (a, g) => {
      a.materialCost += g.materialCost;
      a.labourCost += g.labourCost;
      a.mobilisationCost += g.mobilisationCost;
      a.measuredPotholes += g.measured;
      return a;
    },
    { materialCost: 0, labourCost: 0, mobilisationCost: 0, measuredPotholes: 0 },
  );
  const materialCost = roundMoney(t.materialCost);
  const labourCost = roundMoney(t.labourCost);
  const mobilisationCost = roundMoney(t.mobilisationCost);
  return {
    materialCost,
    labourCost,
    variableCost: roundMoney(materialCost + labourCost),
    mobilisationCost,
    estimatedBudget: roundMoney(materialCost + labourCost + mobilisationCost),
    visitGroups: groups.length,
    measuredPotholes: t.measuredPotholes,
  };
}

export async function budget(match: Match): Promise<BudgetTotals> {
  return sumGroups(await costGroups(match));
}

/** Actual expenditure recorded in scope: completed visits' actual cost + per-pothole actual cost outside visits. */
export async function actualCost(match: Match): Promise<{ actual: number; estimatedForActual: number; itemsWithActual: number }> {
  const visitIds = await Pothole.distinct('repairVisit', { ...match, repairVisit: { $ne: null } });
  const visits = await RepairVisit.find({ _id: { $in: visitIds }, actualCost: { $exists: true, $ne: null } })
    .select('actualCost totalEstimatedCost')
    .lean();
  const loose = await Pothole.aggregate([
    { $match: { ...match, repairVisit: null, actualRepairCost: { $type: 'number' } } },
    { $group: { _id: null, actual: { $sum: '$actualRepairCost' }, est: { $sum: { $ifNull: ['$singleVisitTotal', 0] } }, n: { $sum: 1 } } },
  ]);
  const l = loose[0] ?? { actual: 0, est: 0, n: 0 };
  return {
    actual: roundMoney(visits.reduce((a, x) => a + (x.actualCost ?? 0), 0) + l.actual),
    estimatedForActual: roundMoney(visits.reduce((a, x) => a + (x.totalEstimatedCost ?? 0), 0) + l.est),
    itemsWithActual: visits.length + l.n,
  };
}

export async function overview(match: Match, budgetTarget: number | null) {
  const [counts] = await Pothole.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        unique: { $sum: 1 },
        frameDetections: { $sum: { $ifNull: ['$observationCount', 1] } },
        verified: { $sum: { $cond: [{ $eq: ['$verificationStatus', 'verified'] }, 1, 0] } },
        pendingReview: { $sum: { $cond: [{ $eq: ['$verificationStatus', 'pending_review'] }, 1, 0] } },
        unsubmitted: { $sum: { $cond: [{ $eq: ['$verificationStatus', 'unsubmitted'] }, 1, 0] } },
        needsReview: { $sum: { $cond: ['$needsReview', 1, 0] } },
        minor: { $sum: { $cond: [{ $eq: ['$severity', 'minor'] }, 1, 0] } },
        moderate: { $sum: { $cond: [{ $eq: ['$severity', 'moderate'] }, 1, 0] } },
        severe: { $sum: { $cond: [{ $eq: ['$severity', 'severe'] }, 1, 0] } },
        unclassified: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$severity', null] }, null] }, 1, 0] } },
        repaired: { $sum: { $cond: [{ $eq: ['$repairStatus', 'repaired'] }, 1, 0] } },
        measured: { $sum: { $cond: [{ $eq: ['$measurementStatus', 'complete'] }, 1, 0] } },
        calibrated: { $sum: { $cond: [{ $ne: ['$measurementStatus', 'not_calibrated'] }, 1, 0] } },
        withLocation: { $sum: { $cond: [{ $gt: [{ $size: { $ifNull: ['$location.coordinates', []] } }, 0] }, 1, 0] } },
        avgConfidence: { $avg: '$confidence' },
      },
    },
  ]);
  const c = counts ?? {
    unique: 0, frameDetections: 0, verified: 0, pendingReview: 0, unsubmitted: 0, needsReview: 0, minor: 0,
    moderate: 0, severe: 0, unclassified: 0, repaired: 0, measured: 0, calibrated: 0, withLocation: 0, avgConfidence: null,
  };
  const [total, severe, unrepaired, actual, areas] = await Promise.all([
    budget(match),
    budget({ ...match, severity: 'severe' }),
    budget({ ...match, repairStatus: { $ne: 'repaired' } }),
    actualCost(match),
    Pothole.aggregate([{ $match: match }, { $group: { _id: { w: '$ward', l: '$locality' } } }, { $count: 'n' }]),
  ]);
  delete (c as any)._id;
  return {
    counts: c,
    areasWithPotholes: areas[0]?.n ?? 0,
    budget: total,
    severeBudget: severe,
    unrepairedBudget: unrepaired,
    actual,
    budgetTarget,
    budgetVariance: budgetTarget === null ? null : roundMoney(budgetTarget - total.estimatedBudget),
    averageCostPerMeasuredPothole: total.measuredPotholes ? roundMoney(total.estimatedBudget / total.measuredPotholes) : null,
    verificationRate: c.unique ? c.verified / c.unique : null,
    repairCompletionRate: c.unique ? c.repaired / c.unique : null,
    measurementRate: c.unique ? c.measured / c.unique : null,
  };
}

export async function severityBreakdown(match: Match) {
  const [bySeverity, byLocality, severeAwaiting, trend] = await Promise.all([
    Pothole.aggregate([
      { $match: match },
      { $group: { _id: { $ifNull: ['$severity', 'unclassified'] }, count: { $sum: 1 }, variableCost: { $sum: { $ifNull: ['$variableCost', 0] } }, volume: { $sum: { $ifNull: ['$volumeM3', 0] } } } },
    ]),
    Pothole.aggregate([
      { $match: match },
      { $group: { _id: { locality: { $ifNull: ['$locality', 'Not recorded'] }, severity: { $ifNull: ['$severity', 'unclassified'] } }, count: { $sum: 1 } } },
    ]),
    Pothole.countDocuments({ ...match, severity: 'severe', repairStatus: { $nin: ['repaired'] } }),
    Pothole.aggregate([
      { $match: match },
      { $group: { _id: { p: { $dateToString: { format: '%Y-%m', date: '$detectedAt' } }, s: { $ifNull: ['$severity', 'unclassified'] } }, count: { $sum: 1 } } },
      { $sort: { '_id.p': 1 } },
    ]),
  ]);
  const order = ['minor', 'moderate', 'severe', 'unclassified'];
  const localities = new Map<string, Record<string, number>>();
  for (const r of byLocality) {
    const row = localities.get(r._id.locality) ?? { minor: 0, moderate: 0, severe: 0, unclassified: 0 };
    row[r._id.severity] = r.count;
    localities.set(r._id.locality, row);
  }
  const periods = new Map<string, Record<string, number>>();
  for (const r of trend) {
    const row = periods.get(r._id.p) ?? { minor: 0, moderate: 0, severe: 0, unclassified: 0 };
    row[r._id.s] = r.count;
    periods.set(r._id.p, row);
  }
  return {
    severity: order.map((s) => {
      const r = bySeverity.find((x) => x._id === s);
      return { severity: s, count: r?.count ?? 0, variableCost: roundMoney(r?.variableCost ?? 0), volumeM3: r?.volume ?? 0 };
    }),
    byLocality: [...localities.entries()]
      .map(([locality, v]) => ({ locality, ...v, total: v.minor + v.moderate + v.severe + v.unclassified }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 25),
    severeAwaitingRepair: severeAwaiting,
    trend: [...periods.entries()].map(([period, v]) => ({ period, ...v })),
  };
}

export type AreaLevel = 'road' | 'ward' | 'locality';

export async function areaComparison(match: Match, level: AreaLevel) {
  const field = level === 'road' ? '$roadName' : level === 'ward' ? '$ward' : '$locality';
  const [rows, groups] = await Promise.all([
    Pothole.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: [field, 'Not recorded'] },
          ward: { $first: '$ward' },
          locality: { $first: '$locality' },
          count: { $sum: 1 },
          minor: { $sum: { $cond: [{ $eq: ['$severity', 'minor'] }, 1, 0] } },
          moderate: { $sum: { $cond: [{ $eq: ['$severity', 'moderate'] }, 1, 0] } },
          severe: { $sum: { $cond: [{ $eq: ['$severity', 'severe'] }, 1, 0] } },
          unclassified: { $sum: { $cond: [{ $eq: [{ $ifNull: ['$severity', null] }, null] }, 1, 0] } },
          repaired: { $sum: { $cond: [{ $eq: ['$repairStatus', 'repaired'] }, 1, 0] } },
          maxPriority: { $max: '$priorityScore' },
          avgPriority: { $avg: '$priorityScore' },
          lat: { $avg: { $arrayElemAt: ['$location.coordinates', 1] } },
          lon: { $avg: { $arrayElemAt: ['$location.coordinates', 0] } },
        },
      },
    ]),
    costGroups(match),
  ]);
  const budgetByArea = new Map<string, CostGroup[]>();
  for (const g of groups) {
    const k = (level === 'road' ? g.roadName : level === 'ward' ? g.ward : g.locality) ?? 'Not recorded';
    budgetByArea.set(k, [...(budgetByArea.get(k) ?? []), g]);
  }
  return rows
    .map((r) => {
      const b = sumGroups(budgetByArea.get(r._id) ?? []);
      return {
        name: r._id,
        ward: level === 'ward' ? r._id : r.ward,
        locality: level === 'locality' ? r._id : r.locality,
        count: r.count,
        minor: r.minor,
        moderate: r.moderate,
        severe: r.severe,
        unclassified: r.unclassified,
        repaired: r.repaired,
        maxPriority: r.maxPriority ?? 0,
        avgPriority: r.avgPriority ? Math.round(r.avgPriority * 10) / 10 : 0,
        // Centroid only from records that really have coordinates (null otherwise).
        lat: r.lat ?? null,
        lon: r.lon ?? null,
        ...b,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export async function budgetAnalysis(match: Match) {
  const [total, unrepaired, bySeverity, monthlyGroups, roads, localities, actual, visits] = await Promise.all([
    budget(match),
    budget({ ...match, repairStatus: { $ne: 'repaired' } }),
    severityBreakdown(match).then((s) => s.severity),
    costGroups(match, 'month'),
    areaComparison(match, 'road'),
    areaComparison(match, 'locality'),
    actualCost(match),
    completedVisitsInScope(match),
  ]);
  const months = new Map<string, CostGroup[]>();
  for (const g of monthlyGroups) months.set(g.period!, [...(months.get(g.period!) ?? []), g]);
  return {
    total,
    unrepaired,
    bySeverity,
    byRoad: roads.slice(0, 20).map((r) => ({ name: r.name, estimatedBudget: r.estimatedBudget, variableCost: r.variableCost, mobilisationCost: r.mobilisationCost, count: r.count })),
    byLocality: localities.slice(0, 20).map((r) => ({ name: r.name, estimatedBudget: r.estimatedBudget, variableCost: r.variableCost, mobilisationCost: r.mobilisationCost, count: r.count })),
    monthly: [...months.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([period, gs]) => ({ period, ...sumGroups(gs) })),
    actual,
    visits,
  };
}

async function completedVisitsInScope(match: Match) {
  const visitIds = await Pothole.distinct('repairVisit', { ...match, repairVisit: { $ne: null } });
  return RepairVisit.find({ _id: { $in: visitIds } })
    .select('code title status totalEstimatedCost actualCost scheduledDate completedDate potholes')
    .sort({ createdAt: -1 })
    .limit(50)
    .lean()
    .then((vs) => vs.map((x) => ({ ...x, potholes: x.potholes.length })));
}

export async function trends(match: Match, interval: 'day' | 'week' | 'month') {
  const fmt = PERIOD_FORMAT[interval];
  const [detected, verified, repaired] = await Promise.all([
    Pothole.aggregate([
      { $match: match },
      { $group: { _id: { $dateToString: { format: fmt, date: '$detectedAt' } }, unique: { $sum: 1 }, frames: { $sum: { $ifNull: ['$observationCount', 1] } } } },
    ]),
    Pothole.aggregate([
      { $match: { ...match, verificationStatus: 'verified', reviewedAt: { $type: 'date' } } },
      { $group: { _id: { $dateToString: { format: fmt, date: '$reviewedAt' } }, n: { $sum: 1 } } },
    ]),
    Pothole.aggregate([
      { $match: { ...match, repairStatus: 'repaired', repairedAt: { $type: 'date' } } },
      { $group: { _id: { $dateToString: { format: fmt, date: '$repairedAt' } }, n: { $sum: 1 } } },
    ]),
  ]);
  const periods = new Set<string>([...detected, ...verified, ...repaired].map((r) => r._id));
  return [...periods].sort().map((p) => ({
    period: p,
    detected: detected.find((r) => r._id === p)?.unique ?? 0,
    frameDetections: detected.find((r) => r._id === p)?.frames ?? 0,
    verified: verified.find((r) => r._id === p)?.n ?? 0,
    repaired: repaired.find((r) => r._id === p)?.n ?? 0,
  }));
}

export async function quality(match: Match) {
  const [funnel, confidence, measurement, review] = await Promise.all([
    Pothole.aggregate([{ $match: match }, { $group: { _id: '$repairStatus', n: { $sum: 1 } } }]),
    Pothole.aggregate([
      { $match: match },
      { $bucket: { groupBy: '$confidence', boundaries: [0, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0001], default: 'other', output: { n: { $sum: 1 } } } },
    ]),
    Pothole.aggregate([{ $match: match }, { $group: { _id: '$measurementStatus', n: { $sum: 1 } } }]),
    Pothole.aggregate([{ $match: match }, { $group: { _id: '$verificationStatus', n: { $sum: 1 } } }]),
  ]);
  const labels: Record<string, string> = { '0': '< 0.40', '0.4': '0.40–0.49', '0.5': '0.50–0.59', '0.6': '0.60–0.69', '0.7': '0.70–0.79', '0.8': '0.80–0.89', '0.9': '0.90–1.00' };
  const statusOrder = ['reported', 'scheduled', 'in_progress', 'repaired', 'deferred'];
  return {
    repairFunnel: statusOrder.map((s) => ({ status: s, count: funnel.find((f) => f._id === s)?.n ?? 0 })),
    confidence: confidence.filter((b) => b._id !== 'other').map((b) => ({ bin: labels[String(b._id)] ?? String(b._id), count: b.n })),
    measurement: measurement.map((m) => ({ status: m._id, count: m.n })),
    review: review.map((r) => ({ status: r._id, count: r.n })),
  };
}

export const toObjectId = (id: string) => new Types.ObjectId(id);

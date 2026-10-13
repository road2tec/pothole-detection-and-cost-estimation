import { Types } from 'mongoose';
import { Pothole, type PotholeDoc } from '../models/Pothole.js';
import { Upload } from '../models/Upload.js';
import { Calibration } from '../models/Calibration.js';
import { CameraProfile } from '../models/CameraProfile.js';
import { Road } from '../models/Geo.js';
import { getActiveCostConfig, getSetting, type SettingValue } from './settings.js';
import { measurePothole, type CalibrationLike, type ProfileLike } from './calibration.js';
import { applyEstimate, applyReviewFlags, computePriority, type CostConfigLike } from './potholeEstimates.js';

export interface RecalcContext {
  calibration: CalibrationLike | null;
  profile: ProfileLike | null;
  costConfig: CostConfigLike;
  model: SettingValue<'model'>;
  priority: SettingValue<'priority'>;
  roadImportance: Map<string, number>;
}

export async function loadContext(uploadId: unknown): Promise<RecalcContext> {
  const upload = await Upload.findById(uploadId).lean();
  const [calibration, profile, costConfig, model, priority] = await Promise.all([
    upload?.calibration ? Calibration.findOne({ _id: upload.calibration, active: true }).lean() : null,
    upload?.cameraProfile ? CameraProfile.findById(upload.cameraProfile).lean() : null,
    getActiveCostConfig(),
    getSetting('model'),
    getSetting('priority'),
  ]);
  const roads = upload?.road ? await Road.find({ _id: upload.road }).select('importance').lean() : [];
  return {
    calibration: (calibration as CalibrationLike | null) ?? null,
    profile: (profile as ProfileLike | null) ?? null,
    costConfig: costConfig.toObject() as CostConfigLike,
    model,
    priority,
    roadImportance: new Map(roads.map((r) => [String(r._id), r.importance ?? 3])),
  };
}

/** Recompute every derived field of a pothole from its stored inputs. Returns display notes. */
export function recompute(p: PotholeDoc, ctx: RecalcContext): string[] {
  const notes = measurePothole(p as any, ctx.calibration, ctx.profile);
  applyEstimate(p as any, ctx.costConfig);
  applyReviewFlags(p as any, ctx.model);
  refreshPriority(p, ctx.priority, ctx.roadImportance);
  return notes;
}

export function refreshPriority(p: PotholeDoc, weights: SettingValue<'priority'>, roadImportance?: Map<string, number>) {
  const coords = p.location?.coordinates;
  const pr = computePriority(
    {
      severity: p.severity,
      verificationStatus: p.verificationStatus,
      detectedAt: p.detectedAt,
      roadImportance: p.road ? roadImportance?.get(String(p.road)) ?? null : null,
      hasValidLocation: Array.isArray(coords) && coords.length === 2,
      repairStatus: p.repairStatus,
    },
    weights,
  );
  p.priorityScore = pr.score;
  p.priorityReasons = pr.reasons;
}

/** Recalculate all potholes of an upload (after calibration or profile changes). */
export async function recomputeUpload(uploadId: Types.ObjectId | string): Promise<number> {
  const ctx = await loadContext(uploadId);
  const docs = await Pothole.find({ upload: uploadId });
  for (const doc of docs) {
    recompute(doc, ctx);
    await doc.save();
  }
  return docs.length;
}

/** Periodic refresh of the age component of priority for open potholes. */
export async function refreshAllPriorities(): Promise<number> {
  const weights = await getSetting('priority');
  const roads = await Road.find().select('importance').lean();
  const imp = new Map(roads.map((r) => [String(r._id), r.importance ?? 3]));
  let n = 0;
  const cursor = Pothole.find({ repairStatus: { $ne: 'repaired' }, verificationStatus: { $ne: 'rejected' } }).cursor();
  for await (const doc of cursor) {
    const before = doc.priorityScore;
    refreshPriority(doc, weights, imp);
    if (doc.priorityScore !== before) {
      await Pothole.updateOne({ _id: doc._id }, { priorityScore: doc.priorityScore, priorityReasons: doc.priorityReasons });
      n += 1;
    }
  }
  return n;
}

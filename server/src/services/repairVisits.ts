import { Pothole } from '../models/Pothole.js';
import { RepairVisit } from '../models/RepairVisit.js';
import { estimateVisit } from './costing.js';
import { getActiveCostConfig } from './settings.js';

/**
 * Recompute a visit's estimate from its potholes: Σ material + Σ labour + one mobilisation charge.
 * Planned and in-progress visits use the active configuration. Completed and cancelled visits keep
 * the estimate (and configuration version) they had, so historical figures never change silently.
 */
export async function refreshVisitTotals(visitId: unknown) {
  const visit = await RepairVisit.findById(visitId);
  if (!visit) return null;
  if (visit.status === 'completed' || visit.status === 'cancelled') return visit;
  const potholes = await Pothole.find({ _id: { $in: visit.potholes } }).select('volumeM3').lean();
  const cfg = await getActiveCostConfig();
  const est = estimateVisit(
    potholes.map((p) => (typeof p.volumeM3 === 'number' ? p.volumeM3 : null)),
    { materialPerM3: cfg.materialPerM3, labourPerM3: cfg.labourPerM3, mobilisationPerVisit: cfg.mobilisationPerVisit },
  );
  visit.materialCost = est.materialCost;
  visit.labourCost = est.labourCost;
  visit.mobilisationCost = est.mobilisationCost;
  visit.totalEstimatedCost = est.totalCost;
  visit.unmeasuredCount = est.unmeasuredCount;
  visit.costConfig = cfg._id;
  visit.costConfigVersion = cfg.version;
  await visit.save();
  return visit;
}

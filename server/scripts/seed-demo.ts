/**
 * Optional, clearly labelled DEMO data for exploring dashboards before real surveys exist.
 *
 *   npm run seed:demo                    # 300 demo potholes (default)
 *   npm run seed:demo -- --count 10000   # performance testing
 *   npm run seed:demo:remove             # delete every demo record
 *
 * Every record has isDemo: true, its model version says it is synthetic, and the UI shows a
 * "Demo data" badge. Demo records are excluded from analytics, reports and exports unless the
 * user explicitly selects the demo dataset. Re-running replaces the previous demo set.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { Upload } from '../src/models/Upload.js';
import { Pothole } from '../src/models/Pothole.js';
import { DetectionEvent } from '../src/models/DetectionEvent.js';
import { RepairVisit } from '../src/models/RepairVisit.js';
import { Area, Road } from '../src/models/Geo.js';
import { getActiveCostConfig, getSetting } from '../src/services/settings.js';
import { applyEstimate, applyReviewFlags, computePriority } from '../src/services/potholeEstimates.js';
import { estimateVisit } from '../src/services/costing.js';

const DEMO_EMAIL = 'demo-data@roadsight.invalid';
const DEMO_MODEL = 'DEMO — synthetic record, not an AI detection';

// Deterministic PRNG so repeated seeds produce the same demo set.
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function removeDemo() {
  const counts = await Promise.all([
    Pothole.deleteMany({ isDemo: true }),
    DetectionEvent.deleteMany({ isDemo: true }),
    Upload.deleteMany({ isDemo: true }),
    RepairVisit.deleteMany({ isDemo: true }),
    Road.deleteMany({ isDemo: true }),
    Area.deleteMany({ isDemo: true }),
    User.deleteMany({ email: DEMO_EMAIL }),
  ]);
  return counts.reduce((a, r) => a + r.deletedCount, 0);
}

async function seed(count: number) {
  const rand = mulberry32(20260713);
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const removed = await removeDemo();
  // The demo owner can never sign in: deactivated, random unknown password.
  const owner = await User.create({
    name: 'Demo data (synthetic)',
    email: DEMO_EMAIL,
    role: 'inspector',
    status: 'deactivated',
    passwordHash: await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10),
  });
  const areaDefs = [
    ['Indapur Town', '1', 18.1167, 75.0333],
    ['Bhigwan', '2', 18.3, 74.7667],
    ['Nimgaon Ketki', '3', 18.07, 75.07],
    ['Walchandnagar', '4', 18.0, 74.85],
    ['Kalthan', '5', 18.18, 74.95],
  ] as const;
  const areas = await Area.insertMany(areaDefs.map(([locality, ward]) => ({ locality: `${locality} (demo)`, ward: `D${ward}`, city: 'Indapur', region: 'Pune', isDemo: true })));
  const roadNames = ['Station Road', 'Market Yard Road', 'Bypass', 'College Road', 'MIDC Road', 'Temple Road'];
  const roads = await Road.insertMany(
    areas.flatMap((a, i) => roadNames.slice(0, 3 + (i % 3)).map((n, j) => ({ name: `${n} (demo)`, code: `DEMO-${i}${j}`, area: a._id, importance: 1 + ((i + j) % 5), isDemo: true }))),
  );
  const upload = await Upload.create({
    kind: 'image',
    originalName: 'demo-dataset (synthetic, no file)',
    storagePath: 'demo/none',
    mimeType: 'image/jpeg',
    sizeBytes: 0,
    uploadedBy: owner._id,
    status: 'completed',
    modelVersion: DEMO_MODEL,
    notes: 'Synthetic demo records. Not produced by the AI model.',
    isDemo: true,
  });

  const cfg = (await getActiveCostConfig()).toObject();
  const model = await getSetting('model');
  const weights = await getSetting('priority');
  const now = Date.now();
  const docs = [];
  for (let i = 0; i < count; i++) {
    const road = pick(roads);
    const ai = areas.findIndex((a) => String(a._id) === String(road.area));
    const area = areas[ai];
    const [, , lat0, lon0] = areaDefs[ai];
    const detectedAt = new Date(now - Math.floor(rand() * 180) * 86_400_000 - Math.floor(rand() * 86_400_000));
    const measured = rand() < 0.75;
    const L = 0.2 + rand() * 1.2;
    const W = L * (0.45 + rand() * 0.5);
    const D = 0.02 + rand() * 0.12;
    const ver = rand();
    const verificationStatus = ver < 0.45 ? 'verified' : ver < 0.75 ? 'pending_review' : ver < 0.95 ? 'unsubmitted' : 'rejected';
    const rep = rand();
    const repairStatus = verificationStatus !== 'verified' ? 'reported' : rep < 0.35 ? 'repaired' : rep < 0.55 ? 'scheduled' : rep < 0.62 ? 'deferred' : 'reported';
    const p: any = {
      code: `DEMO-${String(i + 1).padStart(6, '0')}`,
      upload: upload._id,
      uploadedBy: owner._id,
      sourceType: 'image',
      bbox: { x1: 0, y1: 0, x2: 1, y2: 1 },
      confidence: Math.round((0.4 + rand() * 0.58) * 100) / 100,
      modelVersion: DEMO_MODEL,
      detectedAt,
      road: road._id,
      area: area._id,
      roadName: road.name,
      ward: area.ward,
      locality: area.locality,
      location: rand() < 0.85 ? { type: 'Point', coordinates: [lon0 + (rand() - 0.5) * 0.04, lat0 + (rand() - 0.5) * 0.04] } : undefined,
      locationSource: null,
      lengthM: measured ? Math.round(L * 1000) / 1000 : null,
      widthM: measured ? Math.round(W * 1000) / 1000 : null,
      depthM: measured ? Math.round(D * 1000) / 1000 : null,
      dimensionSource: measured ? 'manual' : null,
      depthSource: measured ? 'manual' : null,
      verificationStatus,
      repairStatus,
      repairedAt: repairStatus === 'repaired' ? new Date(detectedAt.getTime() + (3 + rand() * 20) * 86_400_000) : undefined,
      reviewedAt: verificationStatus === 'verified' || verificationStatus === 'rejected' ? new Date(detectedAt.getTime() + (1 + rand() * 5) * 86_400_000) : undefined,
      measurementFlags: [],
      reviewReasons: [],
      isDemo: true,
      history: [{ action: 'demo.seeded', at: new Date(), note: 'Synthetic demo record' }],
    };
    if (p.location) p.locationSource = 'manual';
    applyEstimate(p, cfg as any);
    applyReviewFlags(p, model);
    if (repairStatus === 'repaired' && p.singleVisitTotal) p.actualRepairCost = Math.round(p.singleVisitTotal * (0.85 + rand() * 0.35));
    const pr = computePriority({ severity: p.severity, verificationStatus, detectedAt, roadImportance: road.importance, hasValidLocation: !!p.location, repairStatus }, weights);
    p.priorityScore = pr.score;
    p.priorityReasons = pr.reasons;
    docs.push(p);
  }
  const inserted = [];
  for (let i = 0; i < docs.length; i += 1000) inserted.push(...(await Pothole.insertMany(docs.slice(i, i + 1000), { lean: true })));
  await DetectionEvent.insertMany(inserted.map((p: any) => ({ upload: upload._id, pothole: p._id, confidence: p.confidence, modelVersion: DEMO_MODEL, detectedAt: p.detectedAt, isDemo: true })), { lean: true });

  // A few demo work orders grouping scheduled potholes by road (one mobilisation each).
  const scheduled = inserted.filter((p: any) => p.repairStatus === 'scheduled' && typeof p.volumeM3 === 'number');
  const byRoad = new Map<string, any[]>();
  for (const p of scheduled) byRoad.set(String(p.road), [...(byRoad.get(String(p.road)) ?? []), p]);
  let n = 0;
  for (const [, ps] of [...byRoad.entries()].slice(0, 8)) {
    n += 1;
    const est = estimateVisit(ps.map((p) => p.volumeM3), cfg as any);
    const visit = await RepairVisit.create({
      code: `DEMO-WO-${String(n).padStart(3, '0')}`,
      title: `${ps[0].roadName} patching (demo)`,
      road: ps[0].road,
      area: ps[0].area,
      roadName: ps[0].roadName,
      ward: ps[0].ward,
      locality: ps[0].locality,
      potholes: ps.map((p) => p._id),
      status: 'planned',
      costConfig: cfg._id,
      costConfigVersion: cfg.version,
      materialCost: est.materialCost,
      labourCost: est.labourCost,
      mobilisationCost: est.mobilisationCost,
      totalEstimatedCost: est.totalCost,
      unmeasuredCount: est.unmeasuredCount,
      isDemo: true,
    });
    await Pothole.updateMany({ _id: { $in: ps.map((p) => p._id) } }, { repairVisit: visit._id });
  }
  return { removed, potholes: inserted.length, visits: n, roads: roads.length, areas: areas.length };
}

async function main() {
  const remove = process.argv.includes('--remove');
  const idx = process.argv.indexOf('--count');
  const count = idx > -1 ? Math.max(1, Math.min(200_000, Number(process.argv[idx + 1]) || 300)) : 300;
  await connectDb();
  try {
    if (remove) {
      console.log(`Removed ${await removeDemo()} demo record(s).`);
    } else {
      const started = Date.now();
      const r = await seed(count);
      console.log(`Demo data ready in ${Date.now() - started} ms:`, r);
      console.log('Demo records are hidden by default; choose Dataset → "Live + demo" in filters to view them.');
    }
  } finally {
    await disconnectDb();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

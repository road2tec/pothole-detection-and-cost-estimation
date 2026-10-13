/**
 * API workflow tests. The AI service is MOCKED here (vi.spyOn on aiClient) so the Express logic
 * can be tested in isolation. These tests prove persistence, permissions, calibration, costing,
 * analytics and export logic — NOT detection quality. Genuine inference is tested in
 * ai-service/tests/test_genuine_inference.py and scripts/e2e-smoke.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, auth, createUser, resetDb } from './helpers.js';
import { aiClient, AiServiceError, type AiImageResult } from '../src/integrations/aiClient.js';
import { claimNextJob, runJob } from '../src/jobs/worker.js';
import { Pothole } from '../src/models/Pothole.js';
import { AuditLog } from '../src/models/Misc.js';
import { ProcessingJob } from '../src/models/ProcessingJob.js';

const FIXTURE = path.resolve(__dirname, '../../ai-service/tests/fixtures/images/test_1.jpg');

function mockResult(n: number): AiImageResult {
  return {
    imageWidth: 640,
    imageHeight: 640,
    detectionCount: n,
    detections: Array.from({ length: n }, (_, i) => ({
      index: i + 1,
      label: 'pothole',
      confidence: i === 0 ? 0.86 : 0.45,
      bbox: { x1: 100, y1: 100 + i * 200, x2: 585, y2: 464 + i * 10 },
      maskPolygon: null,
      cropPath: `results/mock/crop_${i}.jpg`,
      measurement: { bboxLengthPx: 485, bboxWidthPx: 364, maskLengthPx: null, maskWidthPx: null, maskAreaPx: null, lengthM: null, widthM: null, dimensionSource: null, limitations: [] },
      depth: { status: 'ok', relativeDepth: 0.2, depthM: null },
    })),
    annotatedPath: 'results/mock/annotated.jpg',
    inferenceMs: 400,
    depthMs: 900,
    depthModelVersion: 'mock-depth',
    modelVersion: 'MOCK/model@test/mock.pt',
    confidenceThreshold: 0.4,
    task: 'detect',
  };
}

let admin: Awaited<ReturnType<typeof createUser>>;
let insp: Awaited<ReturnType<typeof createUser>>;
let insp2: Awaited<ReturnType<typeof createUser>>;
let eng: Awaited<ReturnType<typeof createUser>>;

async function uploadImage(token: string, fields: Record<string, string> = {}) {
  let r = request(app).post('/api/v1/uploads').set(auth(token)).attach('files', FIXTURE, { filename: 'road.jpg', contentType: 'image/jpeg' });
  for (const [k, val] of Object.entries(fields)) r = r.field(k, val);
  const res = await r;
  expect(res.status, JSON.stringify(res.body)).toBe(202);
  return res.body.items[0].id as string;
}

async function processNext() {
  const job = await claimNextJob();
  expect(job).toBeTruthy();
  await runJob(job);
  return job!;
}

beforeAll(async () => {
  await resetDb();
  admin = await createUser('admin');
  insp = await createUser('inspector');
  insp2 = await createUser('inspector');
  eng = await createUser('engineer');
});
afterAll(async () => {
  vi.restoreAllMocks();
  await mongoose.disconnect();
});

describe('role permission matrix (direct API calls)', () => {
  const cases: Array<[string, string, 'admin' | 'engineer' | 'inspector', number]> = [
    ['GET', '/api/v1/users', 'inspector', 403],
    ['GET', '/api/v1/users', 'engineer', 403],
    ['GET', '/api/v1/users', 'admin', 200],
    ['GET', '/api/v1/jobs', 'engineer', 403],
    ['GET', '/api/v1/audit-logs', 'engineer', 403],
    ['GET', '/api/v1/audit-logs', 'admin', 200],
    ['PUT', '/api/v1/settings/cost-rates', 'engineer', 403],
    ['PUT', '/api/v1/settings/model', 'inspector', 403],
    ['GET', '/api/v1/settings/cost-rates', 'inspector', 200],
    ['GET', '/api/v1/repair-visits', 'inspector', 403],
    ['GET', '/api/v1/repair-visits', 'engineer', 200],
    ['POST', '/api/v1/analytics/powerbi-export', 'inspector', 403],
    ['GET', '/api/v1/integrations/powerbi/status', 'inspector', 403],
    ['GET', '/api/v1/integrations/powerbi/configuration', 'engineer', 403],
    ['POST', '/api/v1/camera-profiles', 'engineer', 403],
    ['POST', '/api/v1/potholes/recalculate', 'engineer', 403],
  ];
  it.each(cases)('%s %s as %s -> %i', async (method, url, role, expected) => {
    const token = { admin, engineer: eng, inspector: insp }[role].token;
    const res = await (request(app) as any)[method.toLowerCase()](url).set(auth(token)).send({});
    expect(res.status).toBe(expected);
  });
});

describe('upload validation', () => {
  it('rejects a non-image disguised as JPEG', async () => {
    const res = await request(app).post('/api/v1/uploads').set(auth(insp.token)).attach('files', Buffer.from('not an image at all'), { filename: 'x.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(400);
  });
  it('rejects unsupported types and empty uploads', async () => {
    expect((await request(app).post('/api/v1/uploads').set(auth(insp.token)).attach('files', Buffer.from('hello'), { filename: 'x.txt', contentType: 'text/plain' })).status).toBe(400);
    expect((await request(app).post('/api/v1/uploads').set(auth(insp.token))).status).toBe(400);
  });
  it('rejects invalid coordinates', async () => {
    const res = await request(app).post('/api/v1/uploads').set(auth(insp.token)).attach('files', FIXTURE, { filename: 'road.jpg', contentType: 'image/jpeg' }).field('lat', '123').field('lon', '75');
    expect(res.status).toBe(400);
  });
});

describe('detection workflow (mocked AI)', () => {
  let uploadId: string;
  let potholeId: string;

  it('processes an upload and stores honest uncalibrated records', async () => {
    vi.spyOn(aiClient, 'detectImage').mockResolvedValueOnce(mockResult(2));
    uploadId = await uploadImage(insp.token, { roadName: 'MG Road', ward: 'W1', locality: 'Indapur', lat: '18.12', lon: '75.03' });
    await processNext();
    const res = await request(app).get(`/api/v1/uploads/${uploadId}`).set(auth(insp.token));
    expect(res.body.upload.status).toBe('completed');
    expect(res.body.potholes).toHaveLength(2);
    const [p1, p2] = res.body.potholes;
    potholeId = p1._id;
    expect(p1.measurementStatus).toBe('not_calibrated');
    expect(p1.lengthM).toBeNull();
    expect(p1.variableCost).toBeNull();
    expect(p1.location.coordinates).toEqual([75.03, 18.12]);
    expect(p2.needsReview).toBe(true); // confidence 0.45 < 0.60
  });

  it('an empty AI result is stored as zero detections', async () => {
    vi.spyOn(aiClient, 'detectImage').mockResolvedValueOnce(mockResult(0));
    const id = await uploadImage(insp.token);
    await processNext();
    const res = await request(app).get(`/api/v1/uploads/${id}`).set(auth(insp.token));
    expect(res.body.upload.status).toBe('completed');
    expect(res.body.upload.detectionCount).toBe(0);
    expect(res.body.potholes).toHaveLength(0);
  });

  it('an unavailable AI service is retried, then fails honestly', async () => {
    const spy = vi.spyOn(aiClient, 'detectImage').mockRejectedValue(new AiServiceError('AI service is unreachable', 'UNREACHABLE'));
    const id = await uploadImage(insp.token);
    const job = await processNext();
    let state = await ProcessingJob.findById(job._id).lean();
    expect(state!.status).toBe('queued'); // scheduled for retry with backoff
    await ProcessingJob.updateOne({ _id: job._id }, { attempts: 3, lockedUntil: null });
    await processNext();
    state = await ProcessingJob.findById(job._id).lean();
    expect(state!.status).toBe('failed');
    const res = await request(app).get(`/api/v1/uploads/${id}`).set(auth(insp.token));
    expect(res.body.upload.status).toBe('failed');
    expect(res.body.potholes).toHaveLength(0);
    spy.mockRestore();
  });

  it('inspectors cannot see other inspectors\' uploads or potholes', async () => {
    expect((await request(app).get(`/api/v1/uploads/${uploadId}`).set(auth(insp2.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/potholes/${potholeId}`).set(auth(insp2.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/potholes/${potholeId}/crop`).set(auth(insp2.token))).status).toBe(403);
    const list = await request(app).get('/api/v1/potholes').set(auth(insp2.token));
    expect(list.body.total).toBe(0);
  });

  it('reference calibration converts pixels to metres (report worked example)', async () => {
    const res = await request(app).post('/api/v1/calibrations').set(auth(insp.token)).send({ uploadId, referenceLengthM: 0.297, point1: { x: 10, y: 10 }, point2: { x: 190, y: 10 } });
    expect(res.status).toBe(201);
    const p = (await request(app).get(`/api/v1/potholes/${potholeId}`).set(auth(insp.token))).body.pothole;
    expect(p.lengthM).toBeCloseTo(0.8, 2);
    expect(p.widthM).toBeCloseTo(0.6, 2);
    expect(p.measurementStatus).toBe('depth_unavailable'); // relative depth only
  });

  it('manual depth produces volume, severity and cost; requires a reason', async () => {
    expect((await request(app).patch(`/api/v1/potholes/${potholeId}/measurements`).set(auth(insp.token)).send({ depthM: 0.06 })).status).toBe(400);
    const res = await request(app).patch(`/api/v1/potholes/${potholeId}/measurements`).set(auth(insp.token)).send({ depthM: 0.06, reason: 'Ruler measurement' });
    expect(res.status).toBe(200);
    const p = res.body.pothole;
    expect(p.volumeM3).toBeCloseTo(0.0226, 3);
    expect(p.calculatedSeverity).toBe('moderate');
    expect(p.singleVisitTotal).toBeGreaterThan(1150);
    expect(p.costConfigVersion).toBe(1);
    expect(p.depthSource).toBe('manual');
  });

  it('rejects physically invalid measurements', async () => {
    const res = await request(app).patch(`/api/v1/potholes/${potholeId}/measurements`).set(auth(eng.token)).send({ depthM: -0.1, reason: 'typo' });
    expect(res.status).toBe(400);
  });

  it('engineer review keeps calculated severity and is audited', async () => {
    await request(app).post(`/api/v1/uploads/${uploadId}/submit`).set(auth(insp.token)).expect(200);
    const noReason = await request(app).patch(`/api/v1/potholes/${potholeId}/review`).set(auth(eng.token)).send({ decision: 'verified', verifiedSeverity: 'severe' });
    expect(noReason.status).toBe(400);
    const res = await request(app).patch(`/api/v1/potholes/${potholeId}/review`).set(auth(eng.token)).send({ decision: 'verified', verifiedSeverity: 'severe', note: 'Edges crumbling' });
    expect(res.status).toBe(200);
    expect(res.body.pothole.calculatedSeverity).toBe('moderate');
    expect(res.body.pothole.severity).toBe('severe');
    expect(await AuditLog.exists({ action: 'pothole.review.verified' })).toBeTruthy();
    expect((await request(app).patch(`/api/v1/potholes/${potholeId}/review`).set(auth(insp.token)).send({ decision: 'verified' })).status).toBe(403);
  });

  it('cost configuration changes are versioned and do not silently rewrite estimates', async () => {
    const put = await request(app).put('/api/v1/settings/cost-rates').set(auth(admin.token)).send({ materialPerM3: 30000, labourPerM3: 7000, mobilisationPerVisit: 800, minorMaxM3: 0.005, severeMinM3: 0.03 });
    expect(put.status).toBe(200);
    expect(put.body.active.version).toBe(2);
    let p = await Pothole.findById(potholeId).lean();
    expect(p!.costConfigVersion).toBe(1);
    await request(app).post('/api/v1/potholes/recalculate').set(auth(admin.token)).expect(200);
    p = await Pothole.findById(potholeId).lean();
    expect(p!.costConfigVersion).toBe(2);
    expect(p!.materialCost).toBeCloseTo(p!.volumeM3! * 30000, 1);
    const invalid = await request(app).put('/api/v1/settings/cost-rates').set(auth(admin.token)).send({ materialPerM3: 1, labourPerM3: 1, mobilisationPerVisit: 1, minorMaxM3: 0.05, severeMinM3: 0.01 });
    expect(invalid.status).toBe(422);
  });
});

describe('analytics and budget aggregation', () => {
  it('charges mobilisation once per road group and once per repair visit', async () => {
    await resetDb();
    admin = await createUser('admin');
    eng = await createUser('engineer');
    insp = await createUser('inspector');
    const base = { modelVersion: 'MOCK', confidence: 0.9, sourceType: 'image', bbox: { x1: 0, y1: 0, x2: 1, y2: 1 }, upload: new mongoose.Types.ObjectId(), measurementStatus: 'complete', severity: 'moderate' };
    const mk = (roadName: string, variable: number, extra: Record<string, unknown> = {}) =>
      ({ ...base, roadName, ward: 'W1', locality: 'L1', volumeM3: variable / 31000, materialCost: variable * 25 / 31, labourCost: variable * 6 / 31, variableCost: variable, ...extra });
    await Pothole.create([mk('Road A', 310), mk('Road A', 620), mk('Road B', 155), { ...base, roadName: 'Road B', ward: 'W1', locality: 'L1', measurementStatus: 'not_calibrated', severity: null }]);
    const ov = (await request(app).get('/api/v1/analytics/overview').set(auth(eng.token))).body;
    expect(ov.counts.unique).toBe(4);
    expect(ov.budget.measuredPotholes).toBe(3);
    expect(ov.budget.variableCost).toBeCloseTo(1085, 1);
    expect(ov.budget.mobilisationCost).toBe(1000); // Road A + Road B, not 3 × 500
    expect(ov.budget.visitGroups).toBe(2);

    // Put all three measured potholes into ONE visit -> one mobilisation charge.
    const ids = (await Pothole.find({ volumeM3: { $type: 'number' } }).select('_id').lean()).map((x) => String(x._id));
    const visit = await request(app).post('/api/v1/repair-visits').set(auth(eng.token)).send({ title: 'Combined visit', potholeIds: ids });
    expect(visit.status).toBe(201);
    expect(visit.body.visit.mobilisationCost).toBe(500);
    const ov2 = (await request(app).get('/api/v1/analytics/overview').set(auth(eng.token))).body;
    expect(ov2.budget.mobilisationCost).toBe(500);
    expect(ov2.budget.estimatedBudget).toBeCloseTo(1585, 1);

    // A pothole cannot be in two open visits.
    const dup = await request(app).post('/api/v1/repair-visits').set(auth(eng.token)).send({ title: 'Duplicate', potholeIds: [ids[0]] });
    expect(dup.status).toBe(400);

    const areas = (await request(app).get('/api/v1/analytics/areas?level=road').set(auth(eng.token))).body;
    const total = areas.items.reduce((a: number, r: any) => a + r.mobilisationCost, 0);
    expect(total).toBe(500); // area breakdown never sums to more than the overall figure

    const exp = await request(app).post('/api/v1/analytics/powerbi-export').set(auth(eng.token)).send({});
    expect(exp.status).toBe(201);
    for (const check of Object.values(exp.body.job.checks) as any[]) expect(check.ok).toBe(true);
    const fact = fs.readFileSync(path.resolve(process.env.STORAGE_DIR!, exp.body.job.directory, 'FactPothole.csv'), 'utf8');
    expect(fact.split('\r\n').filter(Boolean)).toHaveLength(5); // header + 4
  });

  it('API key access to the Power BI feed is read-only and revocable', async () => {
    const created = await request(app).post('/api/v1/integrations/powerbi/api-keys').set(auth(admin.token)).send({ name: 'Scheduled refresh' });
    expect(created.status).toBe(201);
    const ok = await request(app).get('/api/v1/analytics/powerbi-export/latest/DimSeverity.csv').set('X-Api-Key', created.body.key);
    expect(ok.status).toBe(200);
    expect(ok.text).toContain('Moderate');
    expect((await request(app).get('/api/v1/analytics/overview').set('X-Api-Key', created.body.key)).status).toBe(401);
    await request(app).delete(`/api/v1/integrations/powerbi/api-keys/${created.body.id}`).set(auth(admin.token)).expect(204);
    expect((await request(app).get('/api/v1/analytics/powerbi-export/latest/DimSeverity.csv').set('X-Api-Key', created.body.key)).status).toBe(401);
  });

  it('Power BI status reports setup-required instead of a fake connection', async () => {
    const res = await request(app).get('/api/v1/integrations/powerbi/status').set(auth(eng.token));
    expect(res.body.mode).toBe('setup-required');
    expect(res.body.servicePrincipal.verification.connected).toBe(false);
  });
});

describe('reports', () => {
  it('CSV report is generated, formula-safe and only downloadable by its owner or an admin', async () => {
    await Pothole.create({ modelVersion: 'MOCK', confidence: 0.7, sourceType: 'image', bbox: { x1: 0, y1: 0, x2: 1, y2: 1 }, upload: new mongoose.Types.ObjectId(), roadName: '=cmd|calc', ward: 'W2', locality: 'L2' });
    const res = await request(app).post('/api/v1/reports/csv').set(auth(eng.token)).send({ type: 'potholes' });
    expect(res.status).toBe(201);
    const dl = await request(app).get(`/api/v1/reports/${res.body.report._id}/download`).set(auth(eng.token));
    expect(dl.status).toBe(200);
    expect(dl.text).toContain(`'=cmd|calc`);
    const other = await createUser('engineer');
    expect((await request(app).get(`/api/v1/reports/${res.body.report._id}/download`).set(auth(other.token))).status).toBe(403);
    expect((await request(app).get(`/api/v1/reports/${res.body.report._id}/download`).set(auth(admin.token))).status).toBe(200);
  });

  it('PDF report fails honestly when the renderer is unreachable', async () => {
    const spy = vi.spyOn(aiClient, 'renderPdf').mockRejectedValueOnce(new AiServiceError('down', 'UNREACHABLE'));
    const res = await request(app).post('/api/v1/reports/pdf').set(auth(eng.token)).send({});
    expect(res.status).toBe(503);
    spy.mockRestore();
  });
});

#!/usr/bin/env node
/**
 * End-to-end smoke test against RUNNING services (MongoDB, Express API, Python AI service).
 * Uses the genuine pretrained model on a real photograph — nothing is mocked.
 *
 *   SMOKE_ADMIN_EMAIL=... SMOKE_ADMIN_PASSWORD=... node scripts/e2e-smoke.mjs <image.jpg> [video.mp4]
 *
 * Optional: API=http://localhost:5173/api/v1 to go through the Vite dev proxy.
 * Creates throwaway inspector/engineer accounts (unique per run). Run it against a test database.
 */
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.API ?? 'http://localhost:4000/api/v1';
const [IMG, VIDEO] = process.argv.slice(2);
const ADMIN = { email: process.env.SMOKE_ADMIN_EMAIL, password: process.env.SMOKE_ADMIN_PASSWORD };
if (!IMG || !ADMIN.email || !ADMIN.password) {
  console.error('Usage: SMOKE_ADMIN_EMAIL=.. SMOKE_ADMIN_PASSWORD=.. node scripts/e2e-smoke.mjs <image> [video]');
  process.exit(2);
}

let failures = 0;
const ok = (cond, msg, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${msg}${extra ? ` — ${extra}` : ''}`);
  if (!cond) failures += 1;
};

async function call(p, { token, method = 'GET', body, form, raw } = {}) {
  const res = await fetch(API + p, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: form ?? (body ? JSON.stringify(body) : undefined),
  });
  if (raw) return res;
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  if (!res.ok) throw new Error(`${method} ${p} -> ${res.status} ${text.slice(0, 300)}`);
  return json;
}
const login = async (email, password) => (await call('/auth/login', { method: 'POST', body: { email, password } })).accessToken;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitUpload(id, token, timeoutMs = 600_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const d = await call(`/uploads/${id}`, { token });
    if (['completed', 'failed'].includes(d.upload.status)) return d;
    if (Date.now() > end) throw new Error('Timed out waiting for processing');
    await sleep(1500);
  }
}

const health = await call('/health');
ok(health.database === 'connected', 'database connected');
ok(health.ai.reachable && health.ai.model === 'ready', 'AI service reachable and model ready', JSON.stringify(health.ai));

const admin = await login(ADMIN.email, ADMIN.password);
const tag = Date.now().toString(36);
const users = {};
for (const role of ['inspector', 'engineer']) {
  const email = `smoke-${role}-${tag}@example.test`;
  const r = await call('/auth/register', { method: 'POST', body: { name: `Smoke ${role}`, email, password: 'Password12345', role } });
  await call(`/users/${r.user.id}/status`, { token: admin, method: 'PATCH', body: { status: 'active' } });
  users[role] = await login(email, 'Password12345');
}
const insp = users.inspector;
const eng = users.engineer;

for (const [p, t, expect] of [['/users', insp, 403], ['/jobs', eng, 403], ['/audit-logs', insp, 403], ['/settings/cost-rates', insp, 200]]) {
  const res = await call(p, { token: t, raw: true });
  ok(res.status === expect, `RBAC ${p}`, `got ${res.status}, expected ${expect}`);
}

// ---- image: real inference
const form = new FormData();
form.append('files', new Blob([fs.readFileSync(IMG)], { type: 'image/jpeg' }), path.basename(IMG));
form.append('roadName', 'Smoke Test Road');
form.append('ward', 'Ward S');
form.append('locality', 'Smoke Locality');
form.append('lat', '18.1167');
form.append('lon', '75.0333');
const t0 = Date.now();
const up = await call('/uploads', { token: insp, method: 'POST', form });
const detail = await waitUpload(up.items[0].id, insp);
ok(detail.upload.status === 'completed', 'image processed', `${detail.upload.detectionCount} detection(s), ${Math.round(detail.upload.inferenceMs)} ms inference, ${Date.now() - t0} ms end-to-end`);
ok(/@[0-9a-f]{12}\//.test(detail.upload.modelVersion ?? ''), 'pinned model version recorded', detail.upload.modelVersion);
const p0 = detail.potholes[0];
if (!p0) {
  ok(false, 'at least one pothole detected in the smoke image');
  process.exit(1);
}
ok(p0.measurementStatus === 'not_calibrated' && p0.lengthM == null, 'no dimensions before calibration');

const cal = await call('/calibrations', { token: insp, method: 'POST', body: { uploadId: detail.upload._id, referenceLabel: 'A4 sheet', referenceLengthM: 0.297, point1: { x: 100, y: 500 }, point2: { x: 280, y: 500 } } });
ok(Math.abs(cal.calibration.metresPerPixel - 0.00165) < 1e-9, 'reference calibration scale', String(cal.calibration.metresPerPixel));
let p = (await call(`/potholes/${p0._id}`, { token: insp })).pothole;
ok(p.lengthM > 0 && p.widthM > 0 && p.depthM == null, 'length/width after calibration, depth not invented', `${p.lengthM} × ${p.widthM} m`);
p = (await call(`/potholes/${p0._id}/measurements`, { token: insp, method: 'PATCH', body: { depthM: 0.06, reason: 'Ruler measurement (smoke test)' } })).pothole;
const expectedV = Math.round((Math.PI / 4) * p.lengthM * p.widthM * 0.06 * 1e6) / 1e6;
ok(Math.abs(p.volumeM3 - expectedV) < 1e-6 && p.calculatedSeverity, 'volume and severity', `V=${p.volumeM3} m³, ${p.calculatedSeverity}`);

await call(`/uploads/${detail.upload._id}/submit`, { token: insp, method: 'POST' });
p = (await call(`/potholes/${p0._id}/review`, { token: eng, method: 'PATCH', body: { decision: 'verified', note: 'Smoke review' } })).pothole;
ok(p.verificationStatus === 'verified', 'engineer verified');
const visit = await call('/repair-visits', { token: eng, method: 'POST', body: { title: `Smoke visit ${tag}`, potholeIds: detail.potholes.map((x) => x._id) } });
ok(visit.visit.mobilisationCost > 0 && visit.visit.mobilisationCost === (await call('/settings/cost-rates', { token: eng })).active.mobilisationPerVisit, 'mobilisation charged once for the visit');
await call(`/potholes/${p0._id}/status`, { token: eng, method: 'PATCH', body: { repairStatus: 'repaired', actualRepairCost: 1300 } });

const pdf = await call('/reports/pdf', { token: eng, method: 'POST', body: { title: 'Smoke report' } });
ok(pdf.report.status === 'ready', 'PDF report generated', `${pdf.report.sizeBytes} bytes in ${pdf.report.durationMs} ms`);
const csv = await call('/reports/csv', { token: eng, method: 'POST', body: { type: 'potholes' } });
ok(csv.rows >= 1, 'CSV report generated', `${csv.rows} rows`);
const exp = await call('/analytics/powerbi-export', { token: eng, method: 'POST', body: {} });
ok(Object.values(exp.job.checks).every((c) => c.ok), 'Power BI export reconciles with dashboard', JSON.stringify(exp.job.checks));

// ---- video (optional): real inference on every sampled frame + tracking
if (VIDEO) {
  const vf = new FormData();
  vf.append('files', new Blob([fs.readFileSync(VIDEO)], { type: 'video/mp4' }), path.basename(VIDEO));
  vf.append('roadName', 'Smoke Test Road');
  const vu = await call('/uploads', { token: insp, method: 'POST', form: vf });
  const vd = await waitUpload(vu.items[0].id, insp);
  ok(vd.upload.status === 'completed', 'video processed', vd.upload.error ?? '');
  ok(vd.upload.detectionCount >= vd.upload.uniquePotholeCount, 'frame-level detections ≥ unique potholes', `${vd.upload.detectionCount} frame detections → ${vd.upload.uniquePotholeCount} unique`);
  ok(vd.potholes.every((x) => !x.location), 'video potholes without GPX have no coordinates');
}

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll checks passed');
process.exit(failures ? 1 : 0);

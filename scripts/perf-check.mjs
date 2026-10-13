#!/usr/bin/env node
/**
 * Measures dashboard and report performance against a running API (report NFR targets:
 * ~2 s for dashboard queries over 10,000 potholes, ~20 s for a 200-pothole PDF).
 * Seed a test database first: npm --prefix server run seed:demo -- --count 10000
 *
 *   SMOKE_ADMIN_EMAIL=.. SMOKE_ADMIN_PASSWORD=.. node scripts/perf-check.mjs
 */
const API = process.env.API ?? 'http://localhost:4000/api/v1';
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: process.env.SMOKE_ADMIN_EMAIL, password: process.env.SMOKE_ADMIN_PASSWORD }),
}).then((r) => r.json());
const auth = { Authorization: `Bearer ${login.accessToken}` };

async function time(label, path, init = {}) {
  const runs = [];
  let body;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const res = await fetch(API + path, { ...init, headers: { ...auth, ...(init.headers ?? {}) } });
    body = await res.json();
    if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(body)}`);
    runs.push(performance.now() - t);
  }
  runs.sort((a, b) => a - b);
  console.log(`${label.padEnd(44)} median ${runs[1].toFixed(0).padStart(5)} ms   (min ${runs[0].toFixed(0)}, max ${runs[2].toFixed(0)})`);
  return body;
}

const ds = 'dataset=all';
const ov = await time('GET /analytics/overview', `/analytics/overview?${ds}`);
console.log(`  -> ${ov.counts.unique} potholes in scope`);
await time('GET /analytics/severity', `/analytics/severity?${ds}`);
await time('GET /analytics/areas (road)', `/analytics/areas?level=road&${ds}`);
await time('GET /analytics/budget', `/analytics/budget?${ds}`);
await time('GET /analytics/trends (week)', `/analytics/trends?interval=week&${ds}`);
await time('GET /analytics/quality', `/analytics/quality?${ds}`);
await time('GET /potholes (filtered, page 1)', `/potholes?${ds}&severity=severe&sort=priority`);
await time('GET /potholes/map', `/potholes/map?${ds}`);
const t = performance.now();
const pdf = await fetch(`${API}/reports/pdf`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: 'Performance check (200 potholes)', filters: { dataset: 'all', severity: 'severe' } }),
}).then((r) => r.json());
console.log(`POST /reports/pdf (${pdf.report?.potholeCount} in scope, ≤500 listed)`.padEnd(44), `${(performance.now() - t).toFixed(0)} ms, ${pdf.report?.sizeBytes} bytes`);

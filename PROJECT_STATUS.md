# Project status

_Last updated: 2026-10-13_

## Phases

| Phase | Status | Evidence |
|---|---|---|
| 1. Workspace & foundation | ✅ Done | Monorepo, env validation at start-up, health checks, ESLint/oxlint, Prettier, CI workflow |
| 2. Authentication & panels | ✅ Done | JWT + rotating HttpOnly refresh cookie, approval flow, lockout, RBAC, Admin / Engineer / Inspector panels |
| 3. Pretrained AI integration | ✅ Done | `DanielsStulpe/pothole-detection` `yolo26_best.pt` @ `42b586f1…` (MIT); genuine-inference tests pass; nothing trained |
| 4. Calibration & costing | ✅ Done | Reference object + camera profiles; Depth Anything V2 (relative); volume/severity/cost engine with versioned rates |
| 5. Video & map | ✅ Done | 5 fps sampling, IoU tracking (38 frame detections → 2 unique in e2e), GPX association, Leaflet clustering |
| 6. Operational dashboard | ✅ Done | Aggregation endpoints, priority with reasons, work orders (once-per-visit mobilisation), native analytics |
| 7. Power BI | ✅ Export, feed, model docs, DAX, M · ⚠️ not validated in Power BI | Reconciliation checks pass at 10,000 records |
| 8. Reports | ✅ Done | ReportLab PDF (config snapshot, provenance notes), formula-safe CSV, audit log, download authorisation |
| 9. QA | ✅ Done | See below and `docs/testing.md` |
| 10. Delivery | ✅ Done | README, `docs/` (10 documents), `powerbi/README.md` |

## Tests executed (latest run)

| Suite | Result |
|---|---|
| AI service (unit + genuine inference + mocked error paths) | **37 passed** |
| Server (unit + API workflow with mocked AI, real MongoDB) | **79 passed** |
| Client (Vitest + Testing Library) | **11 passed** |
| End-to-end, no mocks (MongoDB + API + AI service via Vite proxy, real photo + video) | **20/20 checks passed** |
| Server lint + type-check, client type-check + production build | Clean |

## Bugs found and fixed by the tests

* Forgot-password response differed for existing vs unknown emails (enumeration) → now depends only on SMTP configuration.
* Money rounding was wrong for values like 1.005 (binary floating point) → decimal-exponent rounding.
* `validateRates` rejected full configuration documents → checks only the three rate fields.

## External dependencies / blockers (documented, not faked)

* **Redis / Celery**, **Docker**: not installed → MongoDB-backed job queue; compose file provided but not run.
* **Power BI Desktop / tenant**: not available → no `.pbix`; DAX/M and Microsoft REST calls untested; the UI shows
  “setup required” until configured.
* **GPU**: none → CPU timings only.
* **SMTP**: not configured → password-reset email path untested (UI tells users to contact an admin).
* **Depth in metres**: needs a camera-specific factor fitted from hand measurements; none exists yet.
* **Local evaluation data**: none → no accuracy claim for local roads.

## Next actions

1. Create the first administrator on the real database (`npm --prefix server run bootstrap:admin`) and replace the
   prototype cost rates with the authorised Schedule of Rates.
2. Collect and label 100–200 local road photos; run `scripts/evaluate_model.py` and record the result.
3. Capture tape-measured depths for one fixed camera set-up and fit the depth factor α.
4. Build and publish the Power BI report from `powerbi/`, then set `POWERBI_SECURE_EMBED_URL`.
5. Run the Docker Compose deployment on the target server behind HTTPS.

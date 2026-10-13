# Testing

All results below were **actually executed** on 2026-10-13 (Windows 11, Intel CPU, 15 GB RAM, no GPU,
Node 24.18, Python 3.12, MongoDB 7.0.4).

## Suites

| Suite | Command | What it covers | Result |
|---|---|---|---|
| AI service — unit | `cd ai-service && .venv/Scripts/python -m pytest tests/test_units.py` | Reference scale (report worked example), homography, depth scaling rules, mask vs bbox measurement, relative-depth sampling, IoU tracker (moving pothole, gaps, separation), path traversal | included below |
| AI service — **genuine inference** | `… pytest tests/test_genuine_inference.py` | Loads the pinned Hugging Face checkpoint and runs it on real photographs: detections, multiple detections sorted, confidence filtering, **genuine empty result** on a blank image, invalid image (422), service-token auth, path traversal (400), calibrated output, relative-only depth, **video duplicate suppression** (synthetic pan of a real photo: frame-level detections > unique tracks), PDF rendering | included below |
| AI service — **mocked** error paths | `… pytest tests/test_mocked_errors.py` | Model deliberately not loaded → 503 `MODEL_NOT_READY`; load failure reported, not hidden | included below |
| **AI service total** | `npm run test:ai` | | **37 passed** |
| Server — costing unit | `cd server && npm test` (`tests/costing.test.ts`) | Volume, severity boundaries (V₁/V₂ inclusive rules), invalid inputs, mobilisation once per visit, unmeasured potholes, decimal money rounding, configuration changes, report worked example (₹1,201) | |
| Server — units | `tests/units.test.ts` | CSV formula-injection safety, coordinate validation, GPX interpolation without extrapolation, homography, calibration provenance, profile resolution mismatch, manual values preserved, implausible depth, low-confidence review, priority explanation | |
| Server — auth | `tests/auth.test.ts` | Pending approval, no self-registered admins, password policy, refresh rotation + reuse detection, logout revocation, lockout, immediate effect of deactivation, forged tokens, no email enumeration, last-admin safeguards | |
| Server — API workflow (**AI mocked**) | `tests/workflow.test.ts` | 16-case **role permission matrix via direct API calls**, upload validation (disguised file, bad type, bad GPS), honest uncalibrated records, empty AI result, AI outage → retry → honest failure, inspector data isolation (uploads, potholes, images, lists), reference calibration, manual depth → volume/severity/cost, invalid measurements, review keeps calculated severity + audit, **cost configuration versioning and recalculation**, **mobilisation once per road group and once per visit**, area totals never exceed overall, Power BI export reconciliation, API-key feed + revocation, setup-required Power BI status, CSV formula safety + report download authorisation, PDF renderer outage → 503 | |
| **Server total** | `npm --prefix server test` | | **79 passed** |
| Client | `npm --prefix client test` | Login validation and server errors, role-based navigation (inspector vs admin), `RequireRole` blocking direct navigation, URL-synced filters and clearing, pagination bounds, error state retry, empty state, severity text labels, missing values never shown as zero | **11 passed** |
| End-to-end (**no mocks**) | `SMOKE_ADMIN_EMAIL=… SMOKE_ADMIN_PASSWORD=… node scripts/e2e-smoke.mjs <photo> [video]` | Running MongoDB + API + AI service through the Vite proxy: RBAC, real upload → genuine inference → no dimensions before calibration → calibration (0.00165 m/px) → depth entry → volume/severity → submit → engineer verify → work order (one mobilisation) → repair status → PDF → CSV → Power BI export reconciliation; **video**: 38 frame-level detections → 2 unique potholes, no invented GPS | **20/20 checks passed** |

Static checks: server ESLint (0 errors) and `tsc` clean; client `tsc -b` clean and `vite build` succeeds; client oxlint
reports only warnings (tuple-array `key` false positives and effect-initialised form state).

Mocked tests are labelled as such in their file headers. They prove application logic, not detection quality.

## Performance (measured)

Run with `scripts/perf-check.mjs` after `npm --prefix server run seed:demo -- --count 10000` on a test database
(≈ 9,500 potholes in scope after excluding rejected), API on the same machine. Median of three runs:

| Operation | Measured | Report target |
|---|---|---|
| `GET /analytics/overview` | 284 ms | ~2 s for 10,000 potholes |
| `GET /analytics/severity` | 61 ms | |
| `GET /analytics/areas?level=road` | 151 ms | |
| `GET /analytics/budget` | 198 ms | |
| `GET /analytics/trends?interval=week` | 83 ms | |
| `GET /potholes` (filtered, page 1) | 45 ms | |
| `GET /potholes/map` (≈ 8,000 points) | 483 ms | |
| PDF report, 500 potholes listed (3,008 in scope) | 6.1 s | ~20 s for 200 potholes |
| Power BI export, 9,504 potholes, 8 tables + reconciliation | 1.2 s | — |
| Image inference, 640×640, CPU (YOLO26) | 0.4–0.75 s per image | ~4 s CPU |
| Image upload → completed record (incl. depth model) | 4.7 s end-to-end | — |
| Video, 4 s @ 25 fps sampled at 5 fps (20 frames) | completed within the smoke test | ~3 min per minute on GPU |

Not measured: GPU timings (no GPU available), 25 concurrent users (no load-testing tool run), long real survey videos
(no real survey footage available — the video test uses a synthetic pan of a real photograph).

## Model evaluation

`ai-service/scripts/evaluate_model.py` on the 10 held-out fixture images (one labelled pothole each):
precision 0.47, recall 0.80, mAP@0.5 0.74, mAP@0.5:0.95 0.34 at confidence 0.40. This is a smoke result on too few,
in-distribution images and is **not** recorded in the application as an evaluation. A proper evaluation needs a
labelled set of local road images (report §3.4.4 target: mAP@0.5 ≥ 0.80).

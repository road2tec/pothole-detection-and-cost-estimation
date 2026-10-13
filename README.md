# Automated Pothole Detection and Repair Cost Analysis

**RoadSight** is a web application for road authorities. It detects potholes in road photographs and survey
videos with a **pretrained Hugging Face model**, converts calibrated detections into length, width, depth and
volume, classifies severity, estimates repair cost, and supports review, repair planning, reports and
Power BI analytics.

Stack: **React 19 + Vite + TypeScript + Tailwind** · **Express 5 + TypeScript + MongoDB (Mongoose)** ·
**Python FastAPI** AI service (Ultralytics, PyTorch, OpenCV, transformers, ReportLab) · **Power BI** star-schema export.

Functional reference: *Pothole_Detection_Preliminary_Report.pdf* (formulas, thresholds and workflow are taken from it;
the report's PostgreSQL/FastAPI back end was replaced by the required MERN + Python microservice architecture).

## What it does

| | |
|---|---|
| Detection | `DanielsStulpe/pothole-detection` `yolo26_best.pt`, pinned to commit `42b586f1`, real boxes + confidence; threshold 0.40, “Needs review” below 0.60. **No training or fine-tuning.** |
| Video | MP4, frames sampled at 5 fps, IoU tracker merges duplicates, best frame kept, GPX interpolation for GPS |
| Calibration | Click two ends of a reference object, or surveyed camera profiles (fixed scale / homography). Without it: “Not calibrated”. |
| Depth | Depth Anything V2 Small (relative). Metres only with a fitted camera factor; otherwise measured depth is entered. |
| Estimates | V = (π/4)·L·W·D → Minor / Moderate / Severe → C = V·(Cmat + Clab) + Cmob, **mobilisation once per repair visit**, versioned rates |
| Workflow | Inspector → upload, calibrate, submit · Engineer → verify/reject, correct, work orders, repair status · Admin → users, rates, thresholds, profiles, jobs, audit |
| Insight | Live analytics (Recharts), Leaflet map (real coordinates only), priority with reasons, PDF/CSV reports, Power BI export with reconciliation |

## Repository layout

```
client/        React app (public site, auth, role-based panels)
server/        Express API, MongoDB models, job worker, analytics, Power BI export, tests
ai-service/    FastAPI: model adapter, depth, video tracking, PDF rendering, tests (genuine inference)
powerbi/       Star schema, DAX measures, Power Query scripts, report guide, theme, exports/
docs/          architecture, database, API, model, calibration, costing, Power BI, security, testing, deployment
scripts/       e2e-smoke.mjs (no mocks), perf-check.mjs
```

## One-terminal setup

Requires Node.js ≥ 20, Python 3.10–3.12 and MongoDB 7 running on `localhost:27017`.

```powershell
# Windows (PowerShell)
git clone https://github.com/road2tec/pothole-detection-and-cost-estimation.git
cd pothole-detection-and-cost-estimation
powershell -ExecutionPolicy Bypass -File .\setup.ps1
```

```bash
# Linux / macOS
git clone https://github.com/road2tec/pothole-detection-and-cost-estimation.git
cd pothole-detection-and-cost-estimation
bash setup.sh
```

The script installs all packages, creates the Python virtualenv, writes `server/.env` and `ai-service/.env` with
freshly generated secrets, asks for the first administrator (email, name, hidden password) and starts all three
services. Open http://localhost:5173. Re-running it keeps existing configuration and accounts; afterwards
`npm run dev` alone starts everything.

## Quick start (manual)

```bash
npm install && npm run install:all
cd ai-service && py -3.12 -m venv .venv && .venv/Scripts/python -m pip install -r requirements-dev.txt --extra-index-url https://download.pytorch.org/whl/cpu && cd ..

cp server/.env.example server/.env            # set JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, AI_SERVICE_TOKEN
cp ai-service/.env.example ai-service/.env    # set the same AI_SERVICE_TOKEN

ADMIN_EMAIL=you@org.in ADMIN_NAME="Your Name" npm --prefix server run bootstrap:admin   # first admin; prompts for password

npm run dev                                    # http://localhost:5173  (AI :8000, API :4000)
```

On Linux/macOS create the venv with `python3.12 -m venv .venv` and use `.venv/bin/python`; `npm run dev` picks the right interpreter.
The first AI-service start downloads the pinned weights (~150 MB) into `model-cache/`.

Optional demo data (labelled, hidden by default, removable):
`npm --prefix server run seed:demo` / `npm --prefix server run seed:demo:remove`.

## Tests

```bash
npm run test:ai                      # 37 tests — includes genuine inference with the pretrained model
npm --prefix server test             # 79 tests — needs MongoDB (uses database pothole_test)
npm --prefix client test             # 11 tests
SMOKE_ADMIN_EMAIL=… SMOKE_ADMIN_PASSWORD=… node scripts/e2e-smoke.mjs ai-service/tests/fixtures/images/test_1.jpg
```

Results, coverage and measured performance: [`docs/testing.md`](docs/testing.md).

## Power BI

`npm --prefix server run export:powerbi` writes the star-schema CSVs to `powerbi/exports/`; the API also serves them as an
authenticated data feed. Build the report with [`powerbi/README.md`](powerbi/README.md). No `.pbix` file is included:
Power BI Desktop was not available to create and validate one.

## Known limitations and external requirements

* **Measurements need calibration.** Without a reference object or surveyed camera profile, only detections are stored.
* **Depth is relative** until a camera profile has a depth factor fitted against hand measurements; until then depth is
  entered manually. Monocular depth is the least reliable measurement.
* **Model accuracy is not established for local roads.** The only evaluation run used 10 public images
  (P 0.47 / R 0.80 / mAP@0.5 0.74). Evaluate on labelled local images before relying on counts.
* **Licences:** detector weights MIT (model card); Ultralytics runtime AGPL-3.0; optional segmentation preset has no stated licence.
* **Prototype cost rates** (₹25,000 / ₹6,000 per m³, ₹500 per visit) are placeholders until replaced with the authorised Schedule of Rates.
* **Not available in the build environment, therefore not run:** Redis/Celery (a MongoDB-backed job queue is used instead),
  Docker (compose file provided, untested), GPU, Power BI Desktop/tenant (DAX, M and Microsoft API calls untested),
  SMTP (password-reset email untested), real survey video with GPX.
* Bounding-box dimensions overestimate irregular potholes; the elliptical-bowl volume is an approximation.

See [`PROJECT_STATUS.md`](PROJECT_STATUS.md) for phase status and next actions.

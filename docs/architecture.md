# Architecture

```
Browser (React 19 + Vite + Tailwind)
   │  HTTPS, JSON, multipart · access token in memory · refresh token in HttpOnly cookie
   ▼
Express 5 API (TypeScript) ──────────────── MongoDB 7 (Mongoose)
   │  • auth, RBAC, validation (Zod), audit       users, uploads, potholes, detection events,
   │  • uploads → MongoDB job queue               calibrations, camera profiles, cost configs,
   │  • worker loop claims jobs atomically        repair visits, reports, audit log, …
   │  • calibration, costing, analytics, reports
   │  HTTP + X-Service-Token (shared secret)
   ▼
Python AI service (FastAPI)
   • PotholeDetector — pretrained Hugging Face checkpoint via Ultralytics, pinned revision
   • DepthEstimator — Depth Anything V2 Small (relative depth)
   • video processor — OpenCV sampling, IoU tracker, best-frame selection (thread-pool jobs)
   • ReportLab PDF renderer
        ▲
        └── shared file store: storage/ (uploads, results, reports, exports)
```

## Responsibilities

| Concern | Where | Why there |
|---|---|---|
| Detection, depth, video tracking, image annotation, PDF layout | Python | Needs PyTorch / OpenCV / ReportLab |
| Pixel → metre conversion, volume, severity, cost, priority | Express (`services/calibration.ts`, `costing.ts`, `potholeEstimates.ts`) | Recalculated whenever a user calibrates, corrects a measurement or changes rates; must work even if the AI service is down |
| Aggregations, budgets, Power BI export | Express + MongoDB aggregation pipelines | Data lives in MongoDB; one implementation of business definitions for UI, reports and Power BI |
| Persistence of jobs | MongoDB `processingjobs` | Durable retry state without Redis |

The AI service returns *pixel* dimensions and *relative* depth. All physical quantities are derived on the
server from stored pixel values, so recalibrating an image or editing a camera profile re-measures existing
records without re-running the model.

## Processing pipeline (image)

1. `POST /api/v1/uploads` validates type by magic bytes and size, reads EXIF GPS, stores the file under a generated
   name, creates `Upload` + `ProcessingJob(queued)` and returns `202` immediately.
2. The worker (`jobs/worker.ts`, configurable concurrency) claims the oldest job with an atomic
   `findOneAndUpdate` and a lock expiry.
3. It calls `POST /detect/image` with the storage-relative path. The AI service runs the detector (and depth model),
   writes the annotated image and crops into `storage/results/<uploadId>/` and returns real model outputs.
4. The worker deletes any records from a previous attempt (idempotency), creates one `Pothole` and one
   `DetectionEvent` per detection, then applies calibration, estimates, review flags and priority.
5. Failures: unreachable / not-ready / timeout errors are retried with exponential back-off (3 attempts);
   invalid input fails immediately. Errors are stored on the job and upload and shown in the UI.

## Processing pipeline (video)

The worker submits `POST /detect/video` (returns a job id), stores the AI job id and polls
`GET /jobs/{id}`, copying progress into the MongoDB job. The AI service samples frames at the configured rate
(default 5 fps), runs the detector on each, links detections with an IoU tracker using constant-velocity
prediction, and keeps the highest-confidence observation of each track. One `Pothole` per track and one
`DetectionEvent` per observation are stored. If the AI service restarts mid-job, the job id is unknown; the
worker clears it and the retry resubmits the video.

## Why no Redis / Celery

Redis and Docker were not available in the build environment. A MongoDB-backed queue provides the needed
properties — durable state, single-claim, retries, progress, and inspection from the admin UI — with one fewer
moving part. The AI service runs long video work on a bounded thread pool. To scale out, run several API
instances (the claim is atomic) and several AI service instances behind a load balancer; replacing the queue
with Celery/Redis only requires changing `jobs/worker.ts`.

## Replacing the detector

Set `DETECTOR_PRESET` or `HF_REPO_ID` / `HF_REVISION` / `HF_CHECKPOINT` in `ai-service/.env`. The adapter refuses
checkpoints whose classes do not include “pothole”. The frontend and API need no change; new records carry the
new `modelVersion`. See `pretrained-model-setup.md`.

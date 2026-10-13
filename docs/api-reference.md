# API reference (`/api/v1`)

All responses are JSON unless a file is streamed. Errors use
`{ "error": { "code": "…", "message": "…", "details"?: [...] } }` with HTTP status 400 (validation), 401, 403, 404,
409, 413 (file too large), 422 (invalid measurement), 429 (rate limited), 503 (dependency unavailable).
List endpoints accept `page` (≥1) and `limit` (≤200) and return `{ items, page, limit, total, pages }`.

Roles: **A** admin, **E** engineer, **I** inspector. "Own" = records from the inspector's own uploads.

## Health

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | public | `{status, database, ai: {reachable, model, depth}}` (503 if MongoDB is down) |

## Auth

| Method | Path | Auth | Body / notes |
|---|---|---|---|
| POST | `/auth/register` | public | `{name, email, password, role: engineer\|inspector, office?, phone?}` → 201, account pending |
| POST | `/auth/login` | public | `{email, password}` → `{accessToken, user}` + refresh cookie |
| POST | `/auth/refresh` | cookie | Rotates refresh cookie → `{accessToken, user}` |
| POST | `/auth/logout` | cookie | Revokes refresh token → 204 |
| GET / PATCH | `/auth/me` | any | Current user / update `{name?, office?, phone?}` |
| POST | `/auth/change-password` | any | `{currentPassword, newPassword}`; revokes sessions |
| POST | `/auth/forgot-password` | public | `{email}` → `{message, emailConfigured}` (no enumeration) |
| POST | `/auth/reset-password` | public | `{token, password}` |

## Users (A)

| Method | Path | Notes |
|---|---|---|
| GET | `/users?status&role&q` | List |
| POST | `/users` | Create active user `{name, email, password, role, office?, phone?}` |
| GET / PATCH | `/users/:id` | Read / update `{name?, role?, office?, phone?, password?}` (last admin protected) |
| PATCH | `/users/:id/status` | `{status: active\|rejected\|deactivated, reason?}` — approve/reject/(de)activate |

## Uploads

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/uploads` | A E I | multipart: `files` (JPG/PNG/MP4, ≤ limits), `gpx?` (video only), `roadId?`, `roadName?`, `ward?`, `locality?`, `lat?`, `lon?`, `cameraProfileId?`, `capturedAt?`, `gpxOffsetSec?`, `notes?` → 202 `{batchId?, items:[{id, jobId, gpsSource}]}` |
| GET | `/uploads?status&kind&mine&batchId` | A E I(own) | With latest job per upload |
| GET | `/uploads/:id` | owner/A/E | `{upload, job, potholes}` |
| GET | `/uploads/:id/status` | owner/A/E | Status + job progress |
| POST | `/uploads/:id/retry` | owner/A | Re-queue a failed upload |
| POST | `/uploads/:id/submit` | owner/A/E | Submit unsubmitted potholes for review |
| GET | `/uploads/:id/original`, `/annotated` | owner/A/E | Image stream |

## AI

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/ai/status` | any | Proxy of AI service `/model/status` + `reachable` |
| GET | `/ai/models` | any | Model info, recorded evaluations, application thresholds |
| GET | `/ai/jobs/:id` | owner/A/E | Processing job |
| POST | `/ai/evaluations` | A | Record an evaluation that was actually run |

Detection is triggered by creating an upload (asynchronous job) rather than a synchronous `detect-image` call, so
large files never block a request. The AI service's own `/detect/*` endpoints are internal (service token).

## Calibration

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/calibrations` | owner/A/E | `{uploadId, referenceLengthM, point1:{x,y}, point2:{x,y}, referenceLabel?, note?}` → re-measures the upload |
| GET | `/calibrations?uploadId` | owner/A/E | History |
| GET | `/calibrations/:id` | owner/A/E | |
| PATCH | `/calibrations/:id/review` | A E | `{reviewStatus: approved\|rejected, note?}` |
| GET | `/camera-profiles` | any | |
| POST / PUT | `/camera-profiles[/:id]` | A | fixed-scale or homography (`imagePoints`, `roadPointsM`) |

## Potholes

Shared filters (also used by analytics, map and reports): `q, roadId, areaId, road, ward, locality,
severity (csv incl. unclassified), verificationStatus, repairStatus, measurementStatus (csv), needsReview,
minConfidence, maxConfidence, from, to (dates), uploadId, hasLocation, includeRejected, dataset (live|demo|all, default live)`.

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/potholes?…&sort=priority\|newest\|oldest\|confidence\|volume\|cost` | A E I(own) | |
| GET | `/potholes/map?…` | A E I(own) | Points with real coordinates + count without location |
| GET | `/potholes/:id` | A E owner | Full record with history, calibration, cost config |
| GET | `/potholes/:id/annotated` `/crop` `/frame` | A E owner | Images |
| GET | `/potholes/:id/observations` | A E owner | Frame-level detections |
| PATCH | `/potholes/:id/review` | A E | `{decision: verified\|rejected, verifiedSeverity?, note?}` (reason required to reject or override) |
| POST | `/potholes/:id/flag` | A E owner | `{reason, flagged}` |
| PATCH | `/potholes/:id/measurements` | A E owner* | `{lengthM?, widthM?, depthM?, revert?: [dimensions\|depth], reason}` (*inspector until reviewed) |
| PATCH | `/potholes/:id/status` | A E | `{repairStatus, actualRepairCost?, note?}` |
| PATCH | `/potholes/:id/location` | A E | `{lat, lon, verified, reason}` (null clears) |
| POST | `/potholes/recalculate` | A | Re-estimate open potholes with the active configuration |

## Repair visits / work orders (A E)

| Method | Path | Notes |
|---|---|---|
| GET | `/repair-visits?status` | |
| POST | `/repair-visits` | `{title, potholeIds[], scheduledDate?, notes?}` — one mobilisation for the visit |
| GET / PATCH | `/repair-visits/:id` | `{title?, status?, scheduledDate?, actualCost?, addPotholeIds?, removePotholeIds?, notes?}` |

## Analytics (A E I — inspectors see own data)

| Method | Path | Notes |
|---|---|---|
| GET | `/analytics/overview?…` | KPI counts, budget, severe & unrepaired budget, actual cost, variance, rates |
| GET | `/analytics/severity?…` | Severity counts/costs, by locality, severe awaiting repair, monthly trend |
| GET | `/analytics/areas?…&level=road\|ward\|locality` | Paginated area comparison with budget |
| GET | `/analytics/budget?…` | Totals, unrepaired, by severity/road/locality, monthly, actual, visits |
| GET | `/analytics/trends?…&interval=day\|week\|month` | Detected / verified / repaired |
| GET | `/analytics/quality?…` | Repair funnel, confidence histogram, measurement & review status |
| POST | `/analytics/powerbi-export` | A E — `{includeDemo}` → export job with reconciliation checks |
| GET | `/analytics/powerbi-export` | A E — export history |
| GET | `/analytics/powerbi-export/:jobId/:file` | A E — download CSV / manifest |
| GET | `/analytics/powerbi-export/latest/:Table.csv` | A E or `X-Api-Key` — Power BI data feed |

## Settings

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET / PUT | `/settings/cost-rates` | read any / write A | PUT creates a new version |
| GET / PUT | `/settings/severity` | read any / write A | New version with updated bands |
| GET / PUT | `/settings/model` | read any / write A | `{confidenceThreshold, reviewConfidenceBelow, includeDepth}` |
| GET / PUT | `/settings/processing` | read any / write A | Upload/video limits, sampling fps |
| GET / PUT | `/settings/priority` | read any / write A | Priority weights |
| GET / PUT | `/settings/budget` | read any / write A | `{targetAmount\|null, label}` |

## Reports

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/reports/pdf` | any | `{title?, filters}` → report (PDF rendered by the AI service) |
| POST | `/reports/csv` | any | `{type: potholes\|areas\|severity\|budget, filters}` |
| GET | `/reports/history` | any | Own (admin: all) |
| GET | `/reports/:id`, `/reports/:id/download` | owner/A | |

## Integrations (Power BI)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/integrations/powerbi/status` | A E | Modes, live verification, data-feed URL, latest export |
| GET | `/integrations/powerbi/configuration` | A | Non-secret config + API keys |
| POST | `/integrations/powerbi/refresh` | A | Trigger dataset refresh (service principal) |
| GET | `/integrations/powerbi/refresh` | A E | Refresh history |
| POST / DELETE | `/integrations/powerbi/api-keys[/:id]` | A | Create (key shown once) / revoke |

## Other

| Method | Path | Auth |
|---|---|---|
| GET / POST / PUT | `/places/areas`, `/places/roads` | read any / write A |
| GET, POST `/:id/retry` | `/jobs` | A |
| GET, POST `/read` | `/notifications` | own |
| GET | `/audit-logs?action&entity&userId&from&to` | A |

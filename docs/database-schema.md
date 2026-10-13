# MongoDB data model

Database: `pothole_intelligence` (tests use `pothole_test`). Models live in `server/src/models/`.
Images and videos are stored in the file store (`storage/`); documents hold relative paths only.

| Collection | Purpose | Key fields | Indexes |
|---|---|---|---|
| `users` | Accounts | name, email (unique), passwordHash (hidden), role, status (pending/active/rejected/deactivated), office, approvedBy, lastLoginAt, failedLogins, lockedUntil | email, status |
| `refreshtokens` | Rotating sessions | user, tokenHash (unique), family, expiresAt (TTL), revokedAt, replacedBy | TTL on expiresAt |
| `passwordresets` | Reset tokens | user, tokenHash, expiresAt (TTL), usedAt | TTL |
| `uploads` | One file | kind, originalName, storagePath, mimeType, sizeBytes, sha256, uploadedBy, road/area + names, gps {lat, lon, source}, capturedAt, gpxPath, cameraProfile, calibration, batchId, status, error, annotatedPath, detectionCount, uniquePotholeCount, inferenceMs, modelVersion, isDemo | uploadedBy, status, createdAt, batchId |
| `processingjobs` | Durable job queue | type, upload, status, progress, stage, attempts/maxAttempts, lockedUntil, workerId, aiJobId, error/errorCode, result | (status, createdAt), upload |
| `potholes` | One unique pothole | code, upload, sourceType, trackId, frame info, media paths, bbox, mask, confidence, modelVersion, detectedAt, road/area/names, `location` (GeoJSON Point), locationSource, calibration, metresPerPixel, L/W/D/V, dimensionSource, depthSource, depthRelative, measurementStatus/Flags, calculated/verified/effective severity, material/labour/variable cost, single-visit totals, costConfig + version, formulaVersion, verificationStatus, needsReview + reasons, inspectorFlag, reviewer, repairStatus, repairVisit, actualRepairCost, priorityScore + reasons, history[], isDemo | upload, uploadedBy, road, area, roadName, ward, locality, severity, verificationStatus, repairStatus, confidence, detectedAt, priorityScore, needsReview, isDemo, `2dsphere(location)`, (upload, trackId) |
| `detectionevents` | Frame-level observation | upload, pothole, trackId, frameIndex, frameTimeSec, bbox, confidence, modelVersion | upload, pothole, detectedAt |
| `calibrations` | Reference calibrations | upload, method, referenceLabel, referenceLengthM, point1/point2, pixelLength, metresPerPixel, image size, createdBy, reviewStatus, active, supersededBy | upload |
| `cameraprofiles` | Fixed mounts | name, method (fixed-scale/homography), metresPerPixel, reference resolution, homography[9], cameraHeightM, tiltDeg, depthAlpha + note, active | name (unique) |
| `areas` | Ward / locality | locality, ward, city, region | (locality, ward, city) unique |
| `roads` | Roads | name, code, area, importance 1–5 | (name, area) unique |
| `costconfigurations` | Versioned rates & bands | version (unique), material/labour/mobilisation, minorMaxM3, severeMinM3, depthPlausibilityMaxM, active, validFrom, changedBy, isPrototypeDefault, note | version, active |
| `systemsettings` | Key/value settings | key (model, processing, priority, budget), value, updatedBy | key |
| `repairvisits` | Work orders | code, title, road/area, potholes[], status, dates, costConfig + version, material/labour/mobilisation/total, unmeasuredCount, actualCost | status |
| `reports` | Generated reports | kind, csvType, filters, generatedBy, costConfigSnapshot, modelVersions, potholeCount, totals, filePath, status, durationMs | generatedBy |
| `modelevaluations` | Recorded evaluations | modelVersion, dataset, imageCount, IoU/conf thresholds, precision, recall, mAP50, mAP50_95 | modelVersion |
| `notifications` | In-app notices | user, type, title, message, link, readAt | (user, createdAt) |
| `auditlogs` | Audit trail | user, userEmail, action, entity, entityId, details, ip, createdAt | action, entity, createdAt |
| `analyticsexportjobs` | Power BI exports | trigger, includeDemo, status, directory, files, checks, durationMs | |
| `apikeys` | Power BI feed keys | name, prefix, keyHash (unique), scopes, lastUsedAt, revokedAt | keyHash |
| `counters` | Sequential codes (PH-, WO-) | _id (prefix), seq | |

Analytics use aggregation pipelines with `$match` on indexed fields; the API never loads whole collections into memory
for dashboards (the Power BI export streams the scoped potholes once per export).

Relationship to the preliminary report's PostgreSQL tables: `users`, `uploads`, `calibrations`, `camera_profiles`,
`potholes`, `cost_config`, `reports` and `audit_log` map one-to-one; `detectionevents`, `repairvisits`, `areas`/`roads`
and the rest were added for de-duplication, once-per-visit costing and area analytics.

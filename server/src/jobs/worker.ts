/**
 * MongoDB-backed background worker. Jobs are claimed atomically (findOneAndUpdate), so several
 * worker loops or server instances never process the same job concurrently. Processing is
 * idempotent: a retry first removes the records written by an earlier attempt for that upload.
 */
import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { ProcessingJob } from '../models/ProcessingJob.js';
import { Upload } from '../models/Upload.js';
import { Pothole } from '../models/Pothole.js';
import { DetectionEvent } from '../models/DetectionEvent.js';
import { aiClient, AiServiceError, type AiBox, type AiMeasurement } from '../integrations/aiClient.js';
import { getSetting } from '../services/settings.js';
import { loadContext, recompute, refreshAllPriorities } from '../services/potholeService.js';
import { parseGpx, positionAt } from '../services/geo.js';
import { storagePath } from '../services/storage.js';
import { notify } from '../services/audit.js';
import { nextCode } from '../utils/codes.js';

const LOCK_MS = 15 * 60_000;
const RETRYABLE = new Set(['UNREACHABLE', 'MODEL_NOT_READY', 'TIMEOUT', 'NOT_FOUND']);
const workerId = `${process.pid}-${crypto.randomUUID().slice(0, 8)}`;

export async function claimNextJob() {
  const now = new Date();
  return ProcessingJob.findOneAndUpdate(
    {
      $or: [
        { status: 'queued', $or: [{ lockedUntil: null }, { lockedUntil: { $lte: now } }] },
        // A running job whose lock expired belonged to a crashed worker.
        { status: 'running', lockedUntil: { $lte: now } },
      ],
    },
    {
      $set: { status: 'running', lockedUntil: new Date(Date.now() + LOCK_MS), workerId, startedAt: now, error: null },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  );
}

interface NewPotholeInput {
  upload: any;
  sourceType: 'image' | 'video';
  label: string;
  confidence: number;
  bbox: AiBox;
  maskPolygon: number[][] | null;
  measurement: AiMeasurement;
  depthRelative: number | null;
  depthModel: string | null;
  imageWidth: number;
  imageHeight: number;
  modelVersion: string;
  framePath?: string;
  annotatedPath: string;
  cropPath: string;
  trackId?: number;
  frameIndex?: number;
  frameTimeSec?: number;
  observationCount?: number;
  location?: { lat: number; lon: number; source: string } | null;
}

function buildPothole(code: string, i: NewPotholeInput) {
  const u = i.upload;
  return new Pothole({
    code,
    upload: u._id,
    uploadedBy: u.uploadedBy,
    sourceType: i.sourceType,
    trackId: i.trackId,
    frameIndex: i.frameIndex,
    frameTimeSec: i.frameTimeSec,
    observationCount: i.observationCount ?? 1,
    framePath: i.framePath ?? (i.sourceType === 'image' ? u.storagePath : undefined),
    annotatedPath: i.annotatedPath,
    cropPath: i.cropPath,
    bbox: i.bbox,
    imageWidth: i.imageWidth,
    imageHeight: i.imageHeight,
    maskPolygon: i.maskPolygon ?? undefined,
    maskAreaPx: i.measurement.maskAreaPx ?? undefined,
    maskLengthPx: i.measurement.maskLengthPx ?? undefined,
    maskWidthPx: i.measurement.maskWidthPx ?? undefined,
    classLabel: i.label,
    confidence: i.confidence,
    modelVersion: i.modelVersion,
    detectedAt: new Date(),
    road: u.road,
    area: u.area,
    roadName: u.roadName,
    ward: u.ward,
    locality: u.locality,
    location: i.location ? { type: 'Point', coordinates: [i.location.lon, i.location.lat] } : undefined,
    locationSource: i.location?.source ?? null,
    depthRelative: i.depthRelative ?? undefined,
    depthModel: i.depthModel ?? undefined,
    isDemo: false,
    history: [{ action: 'detected', at: new Date(), note: `Detected by ${i.modelVersion}` }],
  });
}

async function processImage(job: any, upload: any) {
  const model = await getSetting('model');
  await ProcessingJob.updateOne({ _id: job._id }, { stage: 'Running pothole detection', progress: 20 });
  const result = await aiClient.detectImage({
    path: upload.storagePath,
    outputDir: `results/${upload._id}`,
    confidence: model.confidenceThreshold,
    includeDepth: model.includeDepth,
  });
  await ProcessingJob.updateOne({ _id: job._id }, { stage: 'Saving results', progress: 85 });

  // Idempotency: remove anything written by a previous attempt of this upload.
  await Pothole.deleteMany({ upload: upload._id });
  await DetectionEvent.deleteMany({ upload: upload._id });

  const ctx = await loadContext(upload._id);
  const location =
    upload.gps?.lat !== undefined && upload.gps?.lon !== undefined
      ? { lat: upload.gps.lat, lon: upload.gps.lon, source: upload.gps.source }
      : null;
  const codes = result.detections.length ? await nextCode('PH', result.detections.length) : [];
  const docs = result.detections.map((d, idx) => {
    const doc = buildPothole(codes[idx], {
      upload,
      sourceType: 'image',
      label: d.label,
      confidence: d.confidence,
      bbox: d.bbox,
      maskPolygon: d.maskPolygon,
      measurement: d.measurement,
      depthRelative: d.depth?.relativeDepth ?? null,
      depthModel: result.depthModelVersion,
      imageWidth: result.imageWidth,
      imageHeight: result.imageHeight,
      modelVersion: result.modelVersion,
      annotatedPath: result.annotatedPath,
      cropPath: d.cropPath,
      location,
    });
    recompute(doc, ctx);
    return doc;
  });
  if (docs.length) await Pothole.insertMany(docs);
  if (docs.length) {
    await DetectionEvent.insertMany(
      docs.map((p) => ({
        upload: upload._id,
        pothole: p._id,
        bbox: p.bbox,
        confidence: p.confidence,
        classLabel: p.classLabel,
        modelVersion: p.modelVersion,
        detectedAt: p.detectedAt,
      })),
    );
  }
  await Upload.updateOne(
    { _id: upload._id },
    {
      status: 'completed',
      error: null,
      annotatedPath: result.annotatedPath,
      detectionCount: result.detectionCount,
      uniquePotholeCount: docs.length,
      inferenceMs: result.inferenceMs,
      modelVersion: result.modelVersion,
      width: result.imageWidth,
      height: result.imageHeight,
    },
  );
  return {
    detectionCount: result.detectionCount,
    uniquePotholes: docs.length,
    inferenceMs: result.inferenceMs,
    depthMs: result.depthMs,
    modelVersion: result.modelVersion,
  };
}

async function processVideo(job: any, upload: any) {
  const [processing, model] = await Promise.all([getSetting('processing'), getSetting('model')]);
  let aiJobId: string | undefined = job.aiJobId;
  if (!aiJobId) {
    const submitted = await aiClient.submitVideo({
      path: upload.storagePath,
      outputDir: `results/${upload._id}`,
      sampleFps: processing.videoSampleFps,
      maxDurationSec: processing.maxVideoDurationSec,
      confidence: model.confidenceThreshold,
    });
    aiJobId = submitted.jobId;
    await ProcessingJob.updateOne({ _id: job._id }, { aiJobId, stage: 'Queued in AI service', progress: 1 });
  }
  let status;
  for (;;) {
    try {
      status = await aiClient.videoJob(aiJobId);
    } catch (err) {
      if (err instanceof AiServiceError && err.code === 'NOT_FOUND') {
        // AI service restarted and lost the in-memory job: resubmit on the next attempt.
        await ProcessingJob.updateOne({ _id: job._id }, { $unset: { aiJobId: 1 } });
      }
      throw err;
    }
    await ProcessingJob.updateOne(
      { _id: job._id },
      { progress: Math.min(95, Math.round(status.progress)), stage: status.stage, lockedUntil: new Date(Date.now() + LOCK_MS) },
    );
    if (status.status === 'completed' || status.status === 'failed' || status.status === 'cancelled') break;
    await new Promise((r) => setTimeout(r, 2000));
  }
  if (status.status !== 'completed' || !status.result) {
    throw new AiServiceError(status.error ?? `Video job ${status.status}`, status.errorCode === 'INVALID_INPUT' ? 'INVALID_INPUT' : 'FAILED');
  }
  const r = status.result;
  await Pothole.deleteMany({ upload: upload._id });
  await DetectionEvent.deleteMany({ upload: upload._id });

  // GPS association: only when a valid GPX track was supplied. The video start time is the
  // recording time entered at upload, or the first GPX point; no coordinates are invented.
  let gpx: Awaited<ReturnType<typeof parseGpx>> = [];
  if (upload.gpxPath) {
    try {
      gpx = await parseGpx(storagePath(upload.gpxPath));
    } catch (err) {
      logger.warn({ err, upload: String(upload._id) }, 'GPX could not be parsed; continuing without GPS');
    }
  }
  const startMs = upload.capturedAt ? new Date(upload.capturedAt).getTime() : gpx[0]?.time;
  const locate = (t: number) => {
    // A single manual point is never copied onto every pothole along a moving survey.
    if (!gpx.length || startMs === undefined) return null;
    const pos = positionAt(gpx, startMs + (t + (upload.gpxOffsetSec ?? 0)) * 1000);
    return pos ? { ...pos, source: 'gpx' } : null;
  };

  const ctx = await loadContext(upload._id);
  const codes = r.tracks.length ? await nextCode('PH', r.tracks.length) : [];
  const docs = r.tracks.map((t, idx) => {
    const doc = buildPothole(codes[idx], {
      upload,
      sourceType: 'video',
      label: t.best.label,
      confidence: t.best.confidence,
      bbox: t.best.bbox,
      maskPolygon: t.best.maskPolygon,
      measurement: t.best.measurement,
      depthRelative: null,
      depthModel: null,
      imageWidth: r.imageWidth,
      imageHeight: r.imageHeight,
      modelVersion: r.modelVersion,
      framePath: t.best.framePath,
      annotatedPath: t.best.annotatedPath,
      cropPath: t.best.cropPath,
      trackId: t.trackId,
      frameIndex: t.best.frameIndex,
      frameTimeSec: t.best.timeSec,
      observationCount: t.observationCount,
      location: locate(t.best.timeSec),
    });
    recompute(doc, ctx);
    return doc;
  });
  if (docs.length) await Pothole.insertMany(docs);
  const events = r.tracks.flatMap((t, idx) =>
    t.observations.map((o) => ({
      upload: upload._id,
      pothole: docs[idx]._id,
      trackId: t.trackId,
      frameIndex: o.frameIndex,
      frameTimeSec: o.timeSec,
      bbox: o.bbox,
      confidence: o.confidence,
      classLabel: t.best.label,
      modelVersion: r.modelVersion,
    })),
  );
  if (events.length) await DetectionEvent.insertMany(events);
  await Upload.updateOne(
    { _id: upload._id },
    {
      status: 'completed',
      error: null,
      detectionCount: r.frameLevelDetections,
      uniquePotholeCount: docs.length,
      inferenceMs: r.inferenceMsTotal,
      modelVersion: r.modelVersion,
      width: r.video.width,
      height: r.video.height,
      durationSec: r.video.durationSec,
      annotatedPath: docs[0]?.annotatedPath,
    },
  );
  return {
    sampledFrames: r.sampledFrames,
    frameLevelDetections: r.frameLevelDetections,
    uniquePotholes: docs.length,
    gpsAssociated: docs.filter((d) => d.location?.coordinates?.length).length,
    processingSeconds: r.processingSeconds,
    modelVersion: r.modelVersion,
  };
}

export async function runJob(job: any): Promise<void> {
  const upload = await Upload.findById(job.upload).lean();
  if (!upload) {
    await ProcessingJob.updateOne({ _id: job._id }, { status: 'failed', error: 'Upload no longer exists', finishedAt: new Date() });
    return;
  }
  await Upload.updateOne({ _id: upload._id }, { status: 'processing', error: null });
  try {
    const result = job.type === 'detect-video' ? await processVideo(job, upload) : await processImage(job, upload);
    await ProcessingJob.updateOne(
      { _id: job._id },
      { status: 'completed', progress: 100, stage: 'Completed', result, finishedAt: new Date(), lockedUntil: null, error: null, errorCode: null },
    );
    await notify(
      upload.uploadedBy,
      'job.completed',
      'Analysis complete',
      `${upload.originalName}: ${result.uniquePotholes} unique pothole(s) found`,
      `/app/uploads/${upload._id}`,
    );
  } catch (err) {
    const aiErr = err instanceof AiServiceError ? err : null;
    const code = aiErr?.code ?? 'INTERNAL';
    const retry = aiErr && RETRYABLE.has(aiErr.code) && job.attempts < job.maxAttempts;
    const message = aiErr ? aiErr.message : 'Processing failed due to an internal error';
    if (!aiErr) logger.error({ err, job: String(job._id) }, 'Job failed');
    else logger.warn({ code, message, job: String(job._id), attempt: job.attempts }, 'AI job error');
    if (retry) {
      const backoffMs = Math.min(5 * 60_000, 15_000 * 2 ** (job.attempts - 1));
      await ProcessingJob.updateOne(
        { _id: job._id },
        { status: 'queued', error: message, errorCode: code, stage: `Waiting to retry (${message})`, lockedUntil: new Date(Date.now() + backoffMs) },
      );
      await Upload.updateOne({ _id: upload._id }, { status: 'queued', error: message });
    } else {
      await ProcessingJob.updateOne(
        { _id: job._id },
        { status: 'failed', error: message, errorCode: code, stage: 'Failed', finishedAt: new Date(), lockedUntil: null },
      );
      await Upload.updateOne({ _id: upload._id }, { status: 'failed', error: message });
      await notify(upload.uploadedBy, 'job.failed', 'Analysis failed', `${upload.originalName}: ${message}`, `/app/uploads/${upload._id}`);
    }
  }
}

export async function enqueueUploadJob(uploadId: Types.ObjectId, kind: 'image' | 'video', userId: string) {
  return ProcessingJob.create({
    type: kind === 'video' ? 'detect-video' : 'detect-image',
    upload: uploadId,
    requestedBy: userId,
    status: 'queued',
  });
}

let timer: NodeJS.Timeout | null = null;
let priorityTimer: NodeJS.Timeout | null = null;
let active = 0;
let stopping = false;

async function tick() {
  if (stopping) return;
  while (active < env.WORKER_CONCURRENCY) {
    const job = await claimNextJob().catch((err) => {
      logger.error({ err }, 'Failed to claim job');
      return null;
    });
    if (!job) break;
    active += 1;
    runJob(job)
      .catch((err) => logger.error({ err }, 'Unexpected worker error'))
      .finally(() => {
        active -= 1;
      });
  }
}

export function startWorker() {
  if (timer) return;
  stopping = false;
  timer = setInterval(() => void tick(), env.WORKER_POLL_MS);
  priorityTimer = setInterval(() => void refreshAllPriorities().catch((err) => logger.error({ err }, 'Priority refresh failed')), 30 * 60_000);
  logger.info({ workerId, concurrency: env.WORKER_CONCURRENCY }, 'Job worker started');
}

export function stopWorker() {
  stopping = true;
  if (timer) clearInterval(timer);
  if (priorityTimer) clearInterval(priorityTimer);
  timer = null;
  priorityTimer = null;
}

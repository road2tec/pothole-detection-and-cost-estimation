/** HTTP client for the Python AI microservice. Errors are typed so callers can report them honestly. */
import { env } from '../config/env.js';

export class AiServiceError extends Error {
  constructor(
    message: string,
    public code: 'UNREACHABLE' | 'MODEL_NOT_READY' | 'INVALID_INPUT' | 'TIMEOUT' | 'NOT_FOUND' | 'FAILED',
    public status?: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? env.AI_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${env.AI_SERVICE_URL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), 'X-Service-Token': env.AI_SERVICE_TOKEN },
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new AiServiceError('AI service request timed out', 'TIMEOUT');
    throw new AiServiceError(`AI service is unreachable at ${env.AI_SERVICE_URL}`, 'UNREACHABLE');
  } finally {
    clearTimeout(timer);
  }
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { detail: text };
  }
  if (!res.ok) {
    const detail = body?.detail;
    const message =
      typeof detail === 'string' ? detail : detail?.error ?? detail?.code ?? `AI service error ${res.status}`;
    if (res.status === 503) throw new AiServiceError(String(message), 'MODEL_NOT_READY', 503);
    if (res.status === 404) throw new AiServiceError(String(message), 'NOT_FOUND', 404);
    if (res.status === 400 || res.status === 422) throw new AiServiceError(String(message), 'INVALID_INPUT', res.status);
    if (res.status === 504) throw new AiServiceError(String(message), 'TIMEOUT', 504);
    throw new AiServiceError(String(message), 'FAILED', res.status);
  }
  return body as T;
}

export interface AiCalibration {
  metresPerPixel?: number;
  homography?: number[];
  depthAlpha?: number;
  cameraHeightM?: number;
}

export interface AiBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AiMeasurement {
  bboxLengthPx: number;
  bboxWidthPx: number;
  maskLengthPx: number | null;
  maskWidthPx: number | null;
  maskAreaPx: number | null;
  lengthM: number | null;
  widthM: number | null;
  dimensionSource: 'bbox' | 'mask' | 'homography' | null;
  limitations: string[];
}

export interface AiImageDetection {
  index: number;
  label: string;
  confidence: number;
  bbox: AiBox;
  maskPolygon: number[][] | null;
  cropPath: string;
  measurement: AiMeasurement;
  depth: { status: string; relativeDepth: number | null; depthM: number | null; reason?: string | null; valid?: boolean };
}

export interface AiImageResult {
  imageWidth: number;
  imageHeight: number;
  detectionCount: number;
  detections: AiImageDetection[];
  annotatedPath: string;
  inferenceMs: number;
  depthMs: number | null;
  depthModelVersion: string | null;
  modelVersion: string;
  confidenceThreshold: number;
  task: string;
}

export interface AiTrack {
  trackId: number;
  observationCount: number;
  firstTimeSec: number;
  lastTimeSec: number;
  best: {
    frameIndex: number;
    timeSec: number;
    confidence: number;
    label: string;
    bbox: AiBox;
    maskPolygon: number[][] | null;
    measurement: AiMeasurement;
    framePath: string;
    annotatedPath: string;
    cropPath: string;
  };
  observations: Array<{ frameIndex: number; timeSec: number; confidence: number; bbox: AiBox }>;
}

export interface AiVideoResult {
  video: { fps: number; frameCount: number; durationSec: number; width: number; height: number };
  sampleFps: number;
  sampledFrames: number;
  frameLevelDetections: number;
  uniqueTracks: number;
  tracks: AiTrack[];
  inferenceMsTotal: number;
  processingSeconds: number;
  modelVersion: string;
  imageWidth: number;
  imageHeight: number;
}

export interface AiJob<T> {
  jobId: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage: string;
  error: string | null;
  errorCode: string | null;
  result: T | null;
}

export const aiClient = {
  health: () => call<{ status: string; model: string; depth: string }>('/health', { timeoutMs: 4000 }),
  modelStatus: () => call<any>('/model/status', { timeoutMs: 5000 }),
  modelInfo: () => call<any>('/model/info', { timeoutMs: 5000 }),

  detectImage(opts: {
    path: string;
    outputDir: string;
    confidence?: number;
    calibration?: AiCalibration;
    includeDepth: boolean;
  }) {
    const form = new FormData();
    form.set('path', opts.path);
    form.set('output_dir', opts.outputDir);
    if (opts.confidence !== undefined) form.set('confidence', String(opts.confidence));
    if (opts.calibration && Object.keys(opts.calibration).length) form.set('calibration', JSON.stringify(opts.calibration));
    form.set('include_depth', String(opts.includeDepth));
    return call<AiImageResult>('/detect/image', { method: 'POST', body: form });
  },

  submitVideo(opts: {
    path: string;
    outputDir: string;
    sampleFps: number;
    maxDurationSec: number;
    confidence?: number;
    calibration?: AiCalibration;
  }) {
    return call<{ jobId: string }>('/detect/video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: opts.path,
        outputDir: opts.outputDir,
        sampleFps: opts.sampleFps,
        maxDurationSec: opts.maxDurationSec,
        confidence: opts.confidence,
        calibration: opts.calibration && Object.keys(opts.calibration).length ? opts.calibration : undefined,
      }),
      timeoutMs: 15000,
    });
  },

  videoJob: (jobId: string) => call<AiJob<AiVideoResult>>(`/jobs/${encodeURIComponent(jobId)}`, { timeoutMs: 15000 }),

  homography: (imagePoints: { x: number; y: number }[], roadPointsM: { x: number; y: number }[]) =>
    call<{ homography: number[] }>('/calibration/homography', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imagePoints, roadPointsM }),
      timeoutMs: 10000,
    }),

  renderPdf: (outputPath: string, payload: unknown) =>
    call<{ path: string; sizeBytes: number; pages: number }>('/reports/pdf', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ outputPath, payload }),
      timeoutMs: 120000,
    }),
};

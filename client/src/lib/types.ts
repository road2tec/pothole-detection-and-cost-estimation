export type Role = 'admin' | 'engineer' | 'inspector';
export type Severity = 'minor' | 'moderate' | 'severe';

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  office?: string;
  phone?: string;
  status: 'pending' | 'active' | 'rejected' | 'deactivated';
  lastLoginAt?: string;
  createdAt?: string;
}

export interface Paged<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface BBox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface Job {
  _id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  stage?: string;
  error?: string;
  errorCode?: string;
  attempts?: number;
  maxAttempts?: number;
  result?: Record<string, unknown>;
}

export interface Upload {
  _id: string;
  kind: 'image' | 'video';
  originalName: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  error?: string;
  roadName?: string;
  ward?: string;
  locality?: string;
  gps?: { lat: number; lon: number; source: 'exif' | 'manual' | 'gpx' };
  width?: number;
  height?: number;
  durationSec?: number;
  detectionCount: number;
  uniquePotholeCount: number;
  inferenceMs?: number;
  modelVersion?: string;
  calibration?: string;
  cameraProfile?: { _id: string; name: string; method: string } | string;
  uploadedBy?: { _id: string; name: string; role: Role } | string;
  submittedForReviewAt?: string;
  sizeBytes: number;
  createdAt: string;
  job?: Job | null;
  annotatedPath?: string;
}

export interface Pothole {
  _id: string;
  code: string;
  upload: string | (Partial<Upload> & { _id: string });
  sourceType: 'image' | 'video';
  trackId?: number;
  frameIndex?: number;
  frameTimeSec?: number;
  observationCount?: number;
  bbox: BBox;
  imageWidth?: number;
  imageHeight?: number;
  maskPolygon?: number[][];
  confidence: number;
  classLabel?: string;
  modelVersion: string;
  detectedAt: string;
  roadName?: string;
  ward?: string;
  locality?: string;
  location?: { type: 'Point'; coordinates: [number, number] };
  locationSource?: 'exif' | 'manual' | 'gpx' | 'corrected' | null;
  locationVerified?: boolean;
  calibration?: unknown;
  metresPerPixel?: number;
  lengthM?: number | null;
  widthM?: number | null;
  depthM?: number | null;
  volumeM3?: number | null;
  depthRelative?: number | null;
  depthModel?: string;
  dimensionSource?: 'bbox' | 'mask' | 'homography' | 'manual' | null;
  depthSource?: 'model-scaled' | 'manual' | null;
  measurementStatus: 'not_calibrated' | 'depth_unavailable' | 'complete' | 'invalid';
  measurementFlags?: string[];
  calculatedSeverity?: Severity | null;
  verifiedSeverity?: Severity | null;
  severity?: Severity | null;
  materialCost?: number | null;
  labourCost?: number | null;
  variableCost?: number | null;
  singleVisitMobilisation?: number | null;
  singleVisitTotal?: number | null;
  costConfigVersion?: number;
  costConfig?: CostConfig;
  verificationStatus: 'unsubmitted' | 'pending_review' | 'verified' | 'rejected';
  needsReview?: boolean;
  reviewReasons?: string[];
  inspectorFlag?: { flagged: boolean; reason?: string };
  reviewedBy?: { name: string; role: Role };
  reviewedAt?: string;
  reviewNote?: string;
  repairStatus: 'reported' | 'scheduled' | 'in_progress' | 'repaired' | 'deferred';
  repairVisit?: string | { _id: string; code: string; title: string; status: string };
  actualRepairCost?: number | null;
  priorityScore: number;
  priorityReasons?: string[];
  history?: Array<{ action: string; by?: { name: string; role: Role }; at: string; note?: string; changes?: unknown }>;
  isDemo?: boolean;
}

export interface CostConfig {
  _id?: string;
  version: number;
  currency?: string;
  materialPerM3: number;
  labourPerM3: number;
  mobilisationPerVisit: number;
  minorMaxM3: number;
  severeMinM3: number;
  depthPlausibilityMaxM?: number;
  isPrototypeDefault?: boolean;
  note?: string;
  validFrom?: string;
  changedBy?: { name: string };
  active?: boolean;
}

export interface BudgetTotals {
  materialCost: number;
  labourCost: number;
  variableCost: number;
  mobilisationCost: number;
  estimatedBudget: number;
  visitGroups: number;
  measuredPotholes: number;
}

export interface Overview {
  counts: {
    unique: number;
    frameDetections: number;
    verified: number;
    pendingReview: number;
    unsubmitted: number;
    needsReview: number;
    minor: number;
    moderate: number;
    severe: number;
    unclassified: number;
    repaired: number;
    measured: number;
    calibrated: number;
    withLocation: number;
    avgConfidence: number | null;
  };
  areasWithPotholes: number;
  budget: BudgetTotals;
  severeBudget: BudgetTotals;
  unrepairedBudget: BudgetTotals;
  actual: { actual: number; estimatedForActual: number; itemsWithActual: number };
  budgetTarget: number | null;
  budgetVariance: number | null;
  averageCostPerMeasuredPothole: number | null;
  verificationRate: number | null;
  repairCompletionRate: number | null;
  measurementRate: number | null;
}

export interface RepairVisit {
  _id: string;
  code: string;
  title: string;
  status: 'planned' | 'in_progress' | 'completed' | 'cancelled';
  potholes: Array<string | Pothole>;
  roadName?: string;
  ward?: string;
  locality?: string;
  scheduledDate?: string;
  completedDate?: string;
  materialCost: number;
  labourCost: number;
  mobilisationCost: number;
  totalEstimatedCost: number;
  unmeasuredCount: number;
  actualCost?: number | null;
  costConfigVersion?: number;
  notes?: string;
  createdBy?: { name: string };
  createdAt: string;
}

export interface CameraProfile {
  _id: string;
  name: string;
  description?: string;
  method: 'fixed-scale' | 'homography';
  metresPerPixel?: number;
  referenceWidthPx?: number;
  referenceHeightPx?: number;
  homography?: number[];
  cameraHeightM?: number;
  tiltDeg?: number;
  focalPx?: number;
  depthAlpha?: number;
  depthAlphaNote?: string;
  active: boolean;
}

export interface Notification {
  _id: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
  readAt?: string;
  createdAt: string;
}

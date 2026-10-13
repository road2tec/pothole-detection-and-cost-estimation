import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const SEVERITIES = ['minor', 'moderate', 'severe'] as const;
export const VERIFICATION_STATUSES = ['unsubmitted', 'pending_review', 'verified', 'rejected'] as const;
export const REPAIR_STATUSES = ['reported', 'scheduled', 'in_progress', 'repaired', 'deferred'] as const;
export const MEASUREMENT_STATUSES = [
  'not_calibrated', // no valid pixel-to-metre scale
  'depth_unavailable', // L and W known, depth not available
  'complete', // L, W, D known -> volume, severity, cost
  'invalid', // inputs failed validation
] as const;

const bboxSchema = new Schema({ x1: Number, y1: Number, x2: Number, y2: Number }, { _id: false });

const historySchema = new Schema(
  {
    action: { type: String, required: true },
    by: { type: Schema.Types.ObjectId, ref: 'User' },
    at: { type: Date, default: Date.now },
    note: String,
    changes: Schema.Types.Mixed,
  },
  { _id: false },
);

const potholeSchema = new Schema(
  {
    code: { type: String, unique: true, sparse: true },
    upload: { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    sourceType: { type: String, enum: ['image', 'video'], required: true },
    trackId: Number,
    frameIndex: Number,
    frameTimeSec: Number,
    observationCount: { type: Number, default: 1 },

    // Media paths are relative to STORAGE_DIR and only served through authorised routes.
    framePath: String,
    annotatedPath: String,
    cropPath: String,

    // Model output
    bbox: { type: bboxSchema, required: true },
    imageWidth: Number,
    imageHeight: Number,
    maskPolygon: { type: [[Number]], default: undefined },
    maskAreaPx: Number,
    maskLengthPx: Number,
    maskWidthPx: Number,
    classLabel: { type: String, default: 'pothole' },
    confidence: { type: Number, required: true, min: 0, max: 1, index: true },
    modelVersion: { type: String, required: true },
    detectedAt: { type: Date, default: Date.now, index: true },

    // Location
    road: { type: Schema.Types.ObjectId, ref: 'Road', index: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', index: true },
    roadName: { type: String, index: true },
    ward: { type: String, index: true },
    locality: { type: String, index: true },
    location: {
      type: { type: String, enum: ['Point'] },
      coordinates: { type: [Number], default: undefined }, // [lon, lat]
    },
    locationSource: { type: String, enum: ['exif', 'manual', 'gpx', 'corrected', null], default: null },
    locationVerified: { type: Boolean, default: false },

    // Measurement
    calibration: { type: Schema.Types.ObjectId, ref: 'Calibration' },
    metresPerPixel: Number,
    lengthM: Number,
    widthM: Number,
    depthM: Number,
    volumeM3: Number,
    dimensionSource: { type: String, enum: ['bbox', 'mask', 'homography', 'manual', null], default: null },
    depthSource: { type: String, enum: ['model-scaled', 'manual', null], default: null },
    depthRelative: Number,
    depthModel: String,
    measurementStatus: { type: String, enum: MEASUREMENT_STATUSES, default: 'not_calibrated' },
    measurementFlags: { type: [String], default: [] },
    formulaVersion: String,

    // Severity: calculated is never overwritten by a reviewer; verified holds the reviewer's call.
    calculatedSeverity: { type: String, enum: [...SEVERITIES, null], default: null },
    verifiedSeverity: { type: String, enum: [...SEVERITIES, null], default: null },
    severity: { type: String, enum: [...SEVERITIES, null], default: null, index: true },

    // Cost per pothole. Mobilisation is stored separately and aggregated per repair visit.
    materialCost: Number,
    labourCost: Number,
    variableCost: Number,
    singleVisitMobilisation: Number,
    singleVisitTotal: Number,
    costConfig: { type: Schema.Types.ObjectId, ref: 'CostConfiguration' },
    costConfigVersion: Number,

    // Workflow
    verificationStatus: {
      type: String,
      enum: VERIFICATION_STATUSES,
      default: 'unsubmitted',
      index: true,
    },
    needsReview: { type: Boolean, default: false, index: true },
    reviewReasons: { type: [String], default: [] },
    inspectorFlag: {
      flagged: { type: Boolean, default: false },
      reason: String,
      by: { type: Schema.Types.ObjectId, ref: 'User' },
      at: Date,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    reviewNote: String,

    repairStatus: { type: String, enum: REPAIR_STATUSES, default: 'reported', index: true },
    repairVisit: { type: Schema.Types.ObjectId, ref: 'RepairVisit', index: true },
    actualRepairCost: Number,
    repairedAt: Date,

    priorityScore: { type: Number, default: 0, index: true },
    priorityReasons: { type: [String], default: [] },

    history: { type: [historySchema], default: [] },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

potholeSchema.index({ location: '2dsphere' }, { sparse: true });
potholeSchema.index({ isDemo: 1, detectedAt: -1 });
potholeSchema.index({ upload: 1, trackId: 1 });

export type PotholeAttrs = InferSchemaType<typeof potholeSchema>;
export type PotholeDoc = HydratedDocument<PotholeAttrs>;
export const Pothole = model('Pothole', potholeSchema);

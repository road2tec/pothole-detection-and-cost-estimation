import { Schema, model } from 'mongoose';

export const UPLOAD_STATUSES = ['queued', 'processing', 'completed', 'failed'] as const;

const gpsSchema = new Schema(
  {
    lat: { type: Number, min: -90, max: 90 },
    lon: { type: Number, min: -180, max: 180 },
    source: { type: String, enum: ['exif', 'manual', 'gpx'] },
  },
  { _id: false },
);

const uploadSchema = new Schema(
  {
    kind: { type: String, enum: ['image', 'video'], required: true },
    originalName: { type: String, required: true, maxlength: 255 },
    storagePath: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    sha256: { type: String, index: true },
    width: Number,
    height: Number,
    durationSec: Number,
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    road: { type: Schema.Types.ObjectId, ref: 'Road' },
    area: { type: Schema.Types.ObjectId, ref: 'Area' },
    roadName: { type: String, trim: true, maxlength: 160 },
    ward: { type: String, trim: true, maxlength: 80 },
    locality: { type: String, trim: true, maxlength: 160 },
    gps: gpsSchema,
    capturedAt: Date,
    gpxPath: String,
    gpxOffsetSec: { type: Number, default: 0 },
    cameraProfile: { type: Schema.Types.ObjectId, ref: 'CameraProfile' },
    calibration: { type: Schema.Types.ObjectId, ref: 'Calibration' },
    batchId: { type: String, index: true },
    status: { type: String, enum: UPLOAD_STATUSES, default: 'queued', index: true },
    error: String,
    annotatedPath: String,
    detectionCount: { type: Number, default: 0 },
    uniquePotholeCount: { type: Number, default: 0 },
    inferenceMs: Number,
    modelVersion: String,
    submittedForReviewAt: Date,
    notes: { type: String, maxlength: 2000 },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);
uploadSchema.index({ createdAt: -1 });
export const Upload = model('Upload', uploadSchema);

import { Schema, model } from 'mongoose';

/**
 * Frame-level (or image-level) model observation. Many events can belong to one Pothole
 * (a video track). "Total detections" counts these; "unique potholes" counts Pothole records.
 */
const detectionEventSchema = new Schema(
  {
    upload: { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
    pothole: { type: Schema.Types.ObjectId, ref: 'Pothole', index: true },
    trackId: Number,
    frameIndex: Number,
    frameTimeSec: Number,
    bbox: { x1: Number, y1: Number, x2: Number, y2: Number },
    confidence: { type: Number, required: true },
    classLabel: String,
    modelVersion: String,
    detectedAt: { type: Date, default: Date.now, index: true },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);
export const DetectionEvent = model('DetectionEvent', detectionEventSchema);

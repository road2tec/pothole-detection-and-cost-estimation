import { Schema, model } from 'mongoose';

/**
 * A saved camera set-up. A profile only enables physical measurement when it carries a
 * calibration that was actually measured for that mounting:
 *  - method 'fixed-scale': metres-per-pixel measured at a reference resolution (top-down / fixed mount)
 *  - method 'homography': 3×3 image→road-plane matrix computed from four surveyed road points
 * Depth scaling (report Eq. 4.6) is enabled only when depthAlpha and cameraHeightM are both set.
 */
const cameraProfileSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, trim: true },
    method: { type: String, enum: ['fixed-scale', 'homography'], required: true },
    metresPerPixel: { type: Number, min: 0 },
    referenceWidthPx: { type: Number, min: 1 },
    referenceHeightPx: { type: Number, min: 1 },
    homography: { type: [Number], validate: (v: number[]) => v.length === 0 || v.length === 9 },
    cameraHeightM: { type: Number, min: 0 },
    tiltDeg: { type: Number },
    focalPx: { type: Number, min: 0 },
    depthAlpha: { type: Number, min: 0 },
    depthAlphaNote: { type: String, trim: true },
    active: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const CameraProfile = model('CameraProfile', cameraProfileSchema);

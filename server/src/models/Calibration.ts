import { Schema, model } from 'mongoose';

const pointSchema = new Schema({ x: Number, y: Number }, { _id: false });

const calibrationSchema = new Schema(
  {
    upload: { type: Schema.Types.ObjectId, ref: 'Upload', required: true, index: true },
    method: { type: String, enum: ['reference-object', 'camera-profile'], required: true },
    referenceLabel: { type: String, trim: true, maxlength: 120 },
    referenceLengthM: Number,
    point1: pointSchema,
    point2: pointSchema,
    pixelLength: Number,
    metresPerPixel: { type: Number, required: true },
    cameraProfile: { type: Schema.Types.ObjectId, ref: 'CameraProfile' },
    imageWidth: Number,
    imageHeight: Number,
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    reviewStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,
    supersededBy: { type: Schema.Types.ObjectId, ref: 'Calibration' },
    active: { type: Boolean, default: true },
    note: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);
export const Calibration = model('Calibration', calibrationSchema);

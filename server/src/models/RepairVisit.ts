import { Schema, model } from 'mongoose';

/**
 * A work order: one crew visit that repairs one or more potholes.
 * Mobilisation is charged once per visit (report Eq. 4.9).
 */
const repairVisitSchema = new Schema(
  {
    code: { type: String, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 160 },
    road: { type: Schema.Types.ObjectId, ref: 'Road' },
    area: { type: Schema.Types.ObjectId, ref: 'Area' },
    roadName: String,
    ward: String,
    locality: String,
    scheduledDate: Date,
    completedDate: Date,
    status: {
      type: String,
      enum: ['planned', 'in_progress', 'completed', 'cancelled'],
      default: 'planned',
      index: true,
    },
    potholes: [{ type: Schema.Types.ObjectId, ref: 'Pothole' }],
    costConfig: { type: Schema.Types.ObjectId, ref: 'CostConfiguration' },
    costConfigVersion: Number,
    materialCost: { type: Number, default: 0 },
    labourCost: { type: Number, default: 0 },
    mobilisationCost: { type: Number, default: 0 },
    totalEstimatedCost: { type: Number, default: 0 },
    unmeasuredCount: { type: Number, default: 0 },
    actualCost: Number,
    notes: { type: String, maxlength: 2000 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);
export const RepairVisit = model('RepairVisit', repairVisitSchema);

import { Schema, model } from 'mongoose';

/**
 * Versioned cost rates and severity limits (report table cost_config).
 * Rows are never edited in place: a change creates a new version and deactivates the old one,
 * so every estimate and report can point at the exact configuration it used.
 */
const costConfigurationSchema = new Schema(
  {
    version: { type: Number, required: true, unique: true },
    currency: { type: String, default: 'INR' },
    materialPerM3: { type: Number, required: true, min: 0 },
    labourPerM3: { type: Number, required: true, min: 0 },
    mobilisationPerVisit: { type: Number, required: true, min: 0 },
    minorMaxM3: { type: Number, required: true, min: 0 },
    severeMinM3: { type: Number, required: true, min: 0 },
    depthPlausibilityMaxM: { type: Number, default: 0.5 },
    active: { type: Boolean, default: false, index: true },
    validFrom: { type: Date, default: Date.now },
    isPrototypeDefault: { type: Boolean, default: false },
    note: { type: String, maxlength: 500 },
    changedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const CostConfiguration = model('CostConfiguration', costConfigurationSchema);

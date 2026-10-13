import { Schema, model } from 'mongoose';

/** Ward / locality hierarchy used for area-wise analytics. */
const areaSchema = new Schema(
  {
    locality: { type: String, required: true, trim: true },
    ward: { type: String, required: true, trim: true },
    city: { type: String, trim: true, default: '' },
    region: { type: String, trim: true, default: '' },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);
areaSchema.index({ locality: 1, ward: 1, city: 1 }, { unique: true });
export const Area = model('Area', areaSchema);

const roadSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, trim: true },
    area: { type: Schema.Types.ObjectId, ref: 'Area', required: true },
    /** 1 (access lane) … 5 (arterial). Supplied by administrators; used only in priority scoring. */
    importance: { type: Number, min: 1, max: 5, default: 3 },
    isDemo: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);
roadSchema.index({ name: 1, area: 1 }, { unique: true });
export const Road = model('Road', roadSchema);

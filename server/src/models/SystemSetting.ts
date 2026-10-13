import { Schema, model } from 'mongoose';

/** Key/value settings for model thresholds, processing limits and priority weights. */
const systemSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);
export const SystemSetting = model('SystemSetting', systemSettingSchema);

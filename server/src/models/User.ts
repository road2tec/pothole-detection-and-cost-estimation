import { Schema, model, type InferSchemaType, type HydratedDocument } from 'mongoose';

export const ROLES = ['admin', 'engineer', 'inspector'] as const;
export type Role = (typeof ROLES)[number];
export const USER_STATUSES = ['pending', 'active', 'rejected', 'deactivated'] as const;

const userSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ROLES, required: true },
    office: { type: String, trim: true, maxlength: 160 },
    phone: { type: String, trim: true, maxlength: 30 },
    status: { type: String, enum: USER_STATUSES, default: 'pending', index: true },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    lastLoginAt: Date,
    passwordChangedAt: Date,
    failedLogins: { type: Number, default: 0, select: false },
    lockedUntil: { type: Date, select: false },
  },
  { timestamps: true },
);

userSchema.set('toJSON', {
  transform: (_doc, ret: Record<string, unknown>) => {
    delete ret.passwordHash;
    delete ret.failedLogins;
    delete ret.lockedUntil;
    delete ret.__v;
    return ret;
  },
});

export type UserAttrs = InferSchemaType<typeof userSchema>;
export type UserDoc = HydratedDocument<UserAttrs>;
export const User = model('User', userSchema);

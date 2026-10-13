import { Schema, model } from 'mongoose';

/** Refresh tokens and password-reset tokens are stored only as SHA-256 hashes. */
const refreshTokenSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    replacedBy: String,
    userAgent: String,
    ip: String,
  },
  { timestamps: true },
);
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const RefreshToken = model('RefreshToken', refreshTokenSchema);

const passwordResetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: Date,
  },
  { timestamps: true },
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordReset = model('PasswordReset', passwordResetSchema);

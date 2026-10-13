import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { RefreshToken } from '../models/Token.js';
import type { Role } from '../models/User.js';

export interface AccessClaims {
  sub: string;
  role: Role;
  name: string;
  email: string;
}

export const REFRESH_COOKIE = 'pi_refresh';

export function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function randomToken(bytes = 48): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function signAccessToken(claims: AccessClaims): string {
  return jwt.sign(claims, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    issuer: 'pothole-intelligence',
    audience: 'pothole-intelligence-web',
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  return jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: 'pothole-intelligence',
    audience: 'pothole-intelligence-web',
  }) as AccessClaims;
}

/**
 * Refresh tokens are opaque random strings (not JWTs) stored only as SHA-256 hashes.
 * Each use rotates the token; reuse of a rotated token revokes the whole family.
 */
export async function issueRefreshToken(
  userId: string,
  meta: { userAgent?: string; ip?: string },
  family: string = crypto.randomUUID(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await RefreshToken.create({
    user: userId,
    tokenHash: sha256(token),
    family,
    expiresAt,
    userAgent: meta.userAgent?.slice(0, 300),
    ip: meta.ip,
  });
  return { token, expiresAt };
}

export type RotateResult =
  | { ok: true; userId: string; token: string; expiresAt: Date }
  | { ok: false; reason: 'invalid' | 'expired' | 'reused' };

export async function rotateRefreshToken(
  presented: string,
  meta: { userAgent?: string; ip?: string },
): Promise<RotateResult> {
  const record = await RefreshToken.findOne({ tokenHash: sha256(presented) });
  if (!record) return { ok: false, reason: 'invalid' };
  if (record.revokedAt) {
    // A revoked token was presented again: assume theft and revoke the whole family.
    await RefreshToken.updateMany({ family: record.family, revokedAt: null }, { revokedAt: new Date() });
    return { ok: false, reason: 'reused' };
  }
  if (record.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'expired' };
  const next = await issueRefreshToken(String(record.user), meta, record.family);
  record.revokedAt = new Date();
  record.replacedBy = sha256(next.token);
  await record.save();
  return { ok: true, userId: String(record.user), ...next };
}

export async function revokeRefreshToken(presented: string): Promise<void> {
  await RefreshToken.updateOne({ tokenHash: sha256(presented), revokedAt: null }, { revokedAt: new Date() });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await RefreshToken.updateMany({ user: userId, revokedAt: null }, { revokedAt: new Date() });
}

export function refreshCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'strict' as const,
    path: '/api/v1/auth',
    expires,
  };
}

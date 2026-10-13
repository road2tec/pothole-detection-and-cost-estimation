import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { env, smtpConfigured } from '../config/env.js';
import { User, type UserDoc } from '../models/User.js';
import { PasswordReset } from '../models/Token.js';
import { authenticate } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import {
  changePasswordSchema,
  forgotSchema,
  loginSchema,
  profileSchema,
  registerSchema,
  resetSchema,
} from '../validators/auth.js';
import {
  REFRESH_COOKIE,
  issueRefreshToken,
  randomToken,
  refreshCookieOptions,
  revokeAllForUser,
  revokeRefreshToken,
  rotateRefreshToken,
  sha256,
  signAccessToken,
} from '../services/tokens.js';
import { audit, notify } from '../services/audit.js';
import { sendMail } from '../services/mailer.js';
import { badRequest, conflict, unauthorized } from '../utils/errors.js';

export const authRouter = Router();

const BCRYPT_ROUNDS = 12;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', BCRYPT_ROUNDS);

const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

function publicUser(u: UserDoc | (Record<string, any> & { _id: unknown })) {
  const o = 'toJSON' in u && typeof u.toJSON === 'function' ? u.toJSON() : u;
  return { id: String(o._id), name: o.name, email: o.email, role: o.role, office: o.office, phone: o.phone, status: o.status, lastLoginAt: o.lastLoginAt, createdAt: o.createdAt };
}

async function startSession(req: any, res: any, user: UserDoc) {
  const accessToken = signAccessToken({ sub: String(user._id), role: user.role, name: user.name, email: user.email });
  const refresh = await issueRefreshToken(String(user._id), { userAgent: req.get('user-agent'), ip: req.ip });
  res.cookie(REFRESH_COOKIE, refresh.token, refreshCookieOptions(refresh.expiresAt));
  return { accessToken, user: publicUser(user) };
}

authRouter.post('/register', authLimiter, validate(registerSchema), async (req, res) => {
  const body = v(req);
  if (await User.exists({ email: body.email })) throw conflict('An account with this email already exists');
  const user = await User.create({
    ...body,
    passwordHash: await bcrypt.hash(body.password, BCRYPT_ROUNDS),
    status: 'pending',
  });
  await audit(null, 'user.register', 'User', user._id, { email: user.email, role: user.role });
  const admins = await User.find({ role: 'admin', status: 'active' }).select('_id').lean();
  await Promise.all(
    admins.map((a) =>
      notify(a._id, 'registration', 'New registration awaiting approval', `${user.name} (${user.role})`, '/app/users?status=pending'),
    ),
  );
  res.status(201).json({
    message: 'Registration received. An administrator must approve your account before you can sign in.',
    user: publicUser(user),
  });
});

authRouter.post('/login', authLimiter, validate(loginSchema), async (req, res) => {
  const { email, password } = v(req);
  const user = await User.findOne({ email }).select('+passwordHash +failedLogins +lockedUntil');
  // Same message for unknown user and wrong password to avoid account enumeration.
  const invalid = unauthorized('Invalid email or password');
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH); // keep response time similar for unknown emails
    throw invalid;
  }
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw unauthorized('Account temporarily locked after repeated failed sign-ins. Try again later.');
  }
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    user.failedLogins = (user.failedLogins ?? 0) + 1;
    if (user.failedLogins >= MAX_FAILED) {
      user.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
      user.failedLogins = 0;
    }
    await user.save();
    await audit(null, 'auth.login_failed', 'User', user._id, { email });
    throw invalid;
  }
  if (user.status === 'pending') throw unauthorized('Your account is awaiting administrator approval.');
  if (user.status !== 'active') throw unauthorized('Your account is not active. Contact an administrator.');
  user.failedLogins = 0;
  user.lockedUntil = undefined;
  user.lastLoginAt = new Date();
  await user.save();
  req.user = { id: String(user._id), sub: String(user._id), role: user.role, name: user.name, email: user.email };
  await audit(req, 'auth.login', 'User', user._id);
  res.json(await startSession(req, res, user));
});

authRouter.post('/refresh', async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (!presented) throw unauthorized('No refresh session');
  const result = await rotateRefreshToken(presented, { userAgent: req.get('user-agent'), ip: req.ip });
  if (!result.ok) {
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    throw unauthorized(result.reason === 'reused' ? 'Session revoked for security reasons' : 'Session expired');
  }
  const user = await User.findById(result.userId);
  if (!user || user.status !== 'active') {
    await revokeRefreshToken(result.token);
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
    throw unauthorized('Account is not active');
  }
  res.cookie(REFRESH_COOKIE, result.token, refreshCookieOptions(result.expiresAt));
  res.json({
    accessToken: signAccessToken({ sub: String(user._id), role: user.role, name: user.name, email: user.email }),
    user: publicUser(user),
  });
});

authRouter.post('/logout', async (req, res) => {
  const presented = req.cookies?.[REFRESH_COOKIE];
  if (presented) await revokeRefreshToken(presented);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  res.status(204).end();
});

authRouter.get('/me', authenticate, async (req, res) => {
  const user = await User.findById(req.user!.id);
  res.json({ user: publicUser(user!) });
});

authRouter.patch('/me', authenticate, validate(profileSchema), async (req, res) => {
  const user = await User.findByIdAndUpdate(req.user!.id, v(req), { returnDocument: 'after', runValidators: true });
  await audit(req, 'user.profile_update', 'User', req.user!.id, { fields: Object.keys(v(req)) });
  res.json({ user: publicUser(user!) });
});

authRouter.post('/change-password', authenticate, authLimiter, validate(changePasswordSchema), async (req, res) => {
  const { currentPassword, newPassword } = v(req);
  const user = await User.findById(req.user!.id).select('+passwordHash');
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw badRequest('Current password is incorrect');
  }
  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  user.passwordChangedAt = new Date();
  await user.save();
  await revokeAllForUser(String(user._id));
  await audit(req, 'auth.password_change', 'User', user._id);
  res.clearCookie(REFRESH_COOKIE, refreshCookieOptions());
  res.json({ message: 'Password changed. Please sign in again.' });
});

authRouter.post('/forgot-password', authLimiter, validate(forgotSchema), async (req, res) => {
  const { email } = v(req);
  const user = await User.findOne({ email, status: 'active' });
  if (user) {
    const token = randomToken(32);
    await PasswordReset.create({ user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) });
    const link = `${env.CLIENT_ORIGIN}/reset-password?token=${encodeURIComponent(token)}`;
    const delivery = await sendMail(
      user.email,
      'Reset your Pothole Intelligence password',
      `A password reset was requested for your account.\n\nOpen this link within 30 minutes:\n${link}\n\nIf you did not request this, ignore this email.`,
    );
    await audit(null, 'auth.password_reset_requested', 'User', user._id, { delivery });
  }
  // The response never reveals whether the email exists: it depends only on the server-wide
  // SMTP configuration, so users are not told to wait for a message that can never arrive.
  res.json({
    message: smtpConfigured
      ? 'If an active account exists for that email, a reset link has been sent.'
      : 'Email delivery is not configured on this server. Ask an administrator to reset your password.',
    emailConfigured: smtpConfigured,
  });
});

authRouter.post('/reset-password', authLimiter, validate(resetSchema), async (req, res) => {
  const { token, password } = v(req);
  const record = await PasswordReset.findOne({ tokenHash: sha256(token), usedAt: null });
  if (!record || record.expiresAt.getTime() < Date.now()) throw badRequest('Reset link is invalid or has expired');
  const user = await User.findById(record.user).select('+passwordHash');
  if (!user || user.status !== 'active') throw badRequest('Reset link is invalid or has expired');
  user.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  user.passwordChangedAt = new Date();
  await user.save();
  record.usedAt = new Date();
  await record.save();
  await revokeAllForUser(String(user._id));
  await audit(null, 'auth.password_reset', 'User', user._id);
  res.json({ message: 'Password updated. You can now sign in.' });
});

export { BCRYPT_ROUNDS, publicUser };

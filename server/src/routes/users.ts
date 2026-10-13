import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { User, ROLES, USER_STATUSES } from '../models/User.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validate, v } from '../middleware/validate.js';
import { passwordSchema } from '../validators/auth.js';
import { BCRYPT_ROUNDS, publicUser } from './auth.js';
import { audit, notify } from '../services/audit.js';
import { revokeAllForUser } from '../services/tokens.js';
import { badRequest, conflict, notFound } from '../utils/errors.js';
import { escapeRegex, pageMeta, paginationSchema } from '../utils/pagination.js';

export const usersRouter = Router();
usersRouter.use(authenticate, requireRole('admin'));

const listQuery = paginationSchema.extend({
  status: z.enum(USER_STATUSES).optional(),
  role: z.enum(ROLES).optional(),
  q: z.string().trim().max(100).optional(),
});

usersRouter.get('/', validate(listQuery, 'query'), async (req, res) => {
  const q = v(req, 'query');
  const filter: Record<string, unknown> = {};
  if (q.status) filter.status = q.status;
  if (q.role) filter.role = q.role;
  if (q.q) {
    const rx = new RegExp(escapeRegex(q.q), 'i');
    filter.$or = [{ name: rx }, { email: rx }, { office: rx }];
  }
  const [items, total] = await Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((q.page - 1) * q.limit).limit(q.limit),
    User.countDocuments(filter),
  ]);
  res.json({ items: items.map(publicUser), ...pageMeta(q, total) });
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  role: z.enum(ROLES),
  office: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(30).optional(),
});

usersRouter.post('/', validate(createSchema), async (req, res) => {
  const body = v(req);
  if (await User.exists({ email: body.email })) throw conflict('An account with this email already exists');
  const user = await User.create({
    ...body,
    passwordHash: await bcrypt.hash(body.password, BCRYPT_ROUNDS),
    status: 'active',
    approvedBy: req.user!.id,
    approvedAt: new Date(),
  });
  await audit(req, 'user.create', 'User', user._id, { email: user.email, role: user.role });
  res.status(201).json({ user: publicUser(user) });
});

usersRouter.get('/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User');
  res.json({ user: publicUser(user) });
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  office: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(30).optional(),
  password: passwordSchema.optional(),
});

async function assertNotLastAdmin(userId: string) {
  const others = await User.countDocuments({ role: 'admin', status: 'active', _id: { $ne: userId } });
  if (others === 0) throw badRequest('At least one active administrator must remain');
}

usersRouter.patch('/:id', validate(updateSchema), async (req, res) => {
  const body = v(req);
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User');
  if (body.role && body.role !== user.role && user.role === 'admin') await assertNotLastAdmin(String(user._id));
  const before = { role: user.role, name: user.name, office: user.office };
  if (body.name !== undefined) user.name = body.name;
  if (body.office !== undefined) user.office = body.office;
  if (body.phone !== undefined) user.phone = body.phone;
  if (body.role !== undefined) user.role = body.role;
  if (body.password) {
    user.passwordHash = await bcrypt.hash(body.password, BCRYPT_ROUNDS);
    user.passwordChangedAt = new Date();
  }
  await user.save();
  if (body.password || (body.role && body.role !== before.role)) await revokeAllForUser(String(user._id));
  await audit(req, 'user.update', 'User', user._id, {
    before,
    after: { role: user.role, name: user.name, office: user.office },
    passwordReset: Boolean(body.password),
  });
  res.json({ user: publicUser(user) });
});

const statusSchema = z.object({
  status: z.enum(['active', 'rejected', 'deactivated']),
  reason: z.string().trim().max(300).optional(),
});

usersRouter.patch('/:id/status', validate(statusSchema), async (req, res) => {
  const { status, reason } = v(req);
  const user = await User.findById(req.params.id);
  if (!user) throw notFound('User');
  if (String(user._id) === req.user!.id && status !== 'active') {
    throw badRequest('You cannot deactivate your own account');
  }
  if (user.role === 'admin' && status !== 'active') await assertNotLastAdmin(String(user._id));
  const previous = user.status;
  user.status = status;
  if (status === 'active' && previous === 'pending') {
    user.approvedBy = req.user!.id as any;
    user.approvedAt = new Date();
  }
  await user.save();
  if (status !== 'active') await revokeAllForUser(String(user._id));
  await audit(req, `user.status.${status}`, 'User', user._id, { previous, reason });
  if (status === 'active' && previous === 'pending') {
    await notify(user._id, 'account', 'Account approved', 'Your account has been approved.', '/app');
  }
  res.json({ user: publicUser(user) });
});

import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { connectDb } from '../src/config/db.js';
import { User, type Role } from '../src/models/User.js';
import { ensureStorage } from '../src/services/storage.js';

export const app = createApp();

export async function resetDb() {
  if (mongoose.connection.readyState !== 1) await connectDb();
  if (!mongoose.connection.name.endsWith('_test')) throw new Error('Refusing to wipe a non-test database');
  await mongoose.connection.dropDatabase();
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  await ensureStorage();
}

export const PASSWORD = 'Password12345';

export async function createUser(role: Role, email = `${role}-${Math.random().toString(36).slice(2, 8)}@example.test`) {
  const user = await User.create({ name: `${role} user`, email, role, status: 'active', passwordHash: await bcrypt.hash(PASSWORD, 4) });
  const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user, token: res.body.accessToken as string, cookie: res.headers['set-cookie'] as unknown as string[] };
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

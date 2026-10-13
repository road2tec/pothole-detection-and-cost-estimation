import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { app, auth, createUser, PASSWORD, resetDb } from './helpers.js';
import { AuditLog } from '../src/models/Misc.js';

beforeAll(resetDb);
afterAll(() => mongoose.disconnect());

describe('registration and approval', () => {
  it('new accounts are pending and cannot sign in until approved', async () => {
    const reg = await request(app).post('/api/v1/auth/register').send({ name: 'Field One', email: 'field1@example.test', password: PASSWORD, role: 'inspector' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.status).toBe('pending');
    expect(reg.body.user.passwordHash).toBeUndefined();

    const blocked = await request(app).post('/api/v1/auth/login').send({ email: 'field1@example.test', password: PASSWORD });
    expect(blocked.status).toBe(401);
    expect(blocked.body.error.message).toMatch(/approval/);

    const admin = await createUser('admin');
    const approve = await request(app).patch(`/api/v1/users/${reg.body.user.id}/status`).set(auth(admin.token)).send({ status: 'active' });
    expect(approve.status).toBe(200);
    const ok = await request(app).post('/api/v1/auth/login').send({ email: 'field1@example.test', password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.accessToken).toBeTruthy();
    expect(await AuditLog.exists({ action: 'user.status.active' })).toBeTruthy();
  });

  it('cannot self-register as administrator', async () => {
    const r = await request(app).post('/api/v1/auth/register').send({ name: 'Sneaky', email: 'sneaky@example.test', password: PASSWORD, role: 'admin' });
    expect(r.status).toBe(400);
  });

  it('enforces the password policy', async () => {
    const r = await request(app).post('/api/v1/auth/register').send({ name: 'Weak', email: 'weak@example.test', password: 'short', role: 'engineer' });
    expect(r.status).toBe(400);
  });
});

describe('sessions', () => {
  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { cookie } = await createUser('engineer', 'rot@example.test');
    const first = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(first.status).toBe(200);
    expect(first.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(first.headers['set-cookie'][0]).toMatch(/SameSite=Strict/);
    // Re-using the original (now rotated) token is treated as theft.
    const reuse = await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(reuse.status).toBe(401);
    const afterRevoke = await request(app).post('/api/v1/auth/refresh').set('Cookie', first.headers['set-cookie']);
    expect(afterRevoke.status).toBe(401);
  });

  it('logout revokes the refresh token', async () => {
    const { cookie } = await createUser('engineer');
    expect((await request(app).post('/api/v1/auth/logout').set('Cookie', cookie)).status).toBe(204);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });

  it('locks the account after repeated failures', async () => {
    await createUser('inspector', 'lock@example.test');
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ email: 'lock@example.test', password: 'WrongPassword1' });
    }
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'lock@example.test', password: PASSWORD });
    expect(r.status).toBe(401);
    expect(r.body.error.message).toMatch(/locked/);
  });

  it('a deactivated user loses access immediately', async () => {
    const admin = await createUser('admin');
    const victim = await createUser('engineer');
    expect((await request(app).get('/api/v1/auth/me').set(auth(victim.token))).status).toBe(200);
    await request(app).patch(`/api/v1/users/${victim.user._id}/status`).set(auth(admin.token)).send({ status: 'deactivated' });
    expect((await request(app).get('/api/v1/auth/me').set(auth(victim.token))).status).toBe(401);
  });

  it('rejects forged or missing tokens', async () => {
    expect((await request(app).get('/api/v1/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/v1/auth/me').set(auth('not.a.jwt'))).status).toBe(401);
  });

  it('forgot-password does not reveal whether an email exists', async () => {
    const a = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.test' });
    const b = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'rot@example.test' });
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.emailConfigured).toBe(false); // SMTP is not configured in tests
  });
});

describe('administrator safeguards', () => {
  it('an admin cannot deactivate themselves or remove the last admin', async () => {
    await resetDb();
    const admin = await createUser('admin');
    const self = await request(app).patch(`/api/v1/users/${admin.user._id}/status`).set(auth(admin.token)).send({ status: 'deactivated' });
    expect(self.status).toBe(400);
    const demote = await request(app).patch(`/api/v1/users/${admin.user._id}`).set(auth(admin.token)).send({ role: 'engineer' });
    expect(demote.status).toBe(400);
  });
});

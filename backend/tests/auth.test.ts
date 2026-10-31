import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, auth, login, seedUsers, startDb, stopDb } from './helpers';
import { User } from '../src/database/models';

beforeAll(async () => {
  await startDb();
  await seedUsers();
});
afterAll(stopDb);

describe('authentication', () => {
  it('logs in with valid credentials and returns permissions', async () => {
    const { res } = await login('cashier@test.local');
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('CASHIER');
    expect(res.body.data.user.permissions).toContain('sales.create');
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly/i);
  });

  it('rejects wrong password and unknown email with the same message', async () => {
    const a = await login('cashier@test.local', 'wrong-password1');
    const b = await login('nobody@test.local', 'whatever123');
    expect(a.res.status).toBe(401);
    expect(b.res.status).toBe(401);
    expect(a.res.body.error.message).toBe(b.res.body.error.message);
  });

  it('requires a token for protected routes', async () => {
    expect((await request(app).get('/api/v1/products')).status).toBe(401);
    expect((await request(app).get('/api/v1/products').set(auth('garbage'))).status).toBe(401);
  });

  it('enforces permissions on the server', async () => {
    const cashier = (await login('cashier@test.local')).token;
    const manager = (await login('manager@test.local')).token;
    const owner = (await login('owner@test.local')).token;
    expect((await request(app).post('/api/v1/users').set(auth(cashier)).send({})).status).toBe(403);
    expect((await request(app).get('/api/v1/reports/sales').set(auth(cashier))).status).toBe(403);
    expect((await request(app).get('/api/v1/reports/sales').set(auth(manager))).status).toBe(200);
    expect(
      (
        await request(app)
          .put('/api/v1/settings')
          .set(auth(manager))
          .send({ store: { name: 'x' } })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .put('/api/v1/settings')
          .set(auth(owner))
          .send({ store: { name: 'Test Mart' } })
      ).status,
    ).toBe(200);
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const { cookie } = await login('manager@test.local');
    const refresh = (c: string) =>
      request(app).post('/api/v1/auth/refresh').set('Cookie', c).set('X-Requested-With', 'pos-web');
    const first = await refresh(cookie!);
    expect(first.status).toBe(200);
    const newCookie = (first.headers['set-cookie'] as unknown as string[])[0];
    expect((await refresh(cookie!)).status).toBe(401); // reuse of rotated token
    expect((await refresh(newCookie)).status).toBe(401); // family revoked
  });

  it('rejects refresh without the CSRF header', async () => {
    const { cookie } = await login('manager@test.local');
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie!)).status).toBe(400);
  });

  it('kills active sessions immediately when an account is disabled', async () => {
    const owner = (await login('owner@test.local')).token;
    const victim = await login('cashier2@test.local');
    expect((await request(app).get('/api/v1/auth/me').set(auth(victim.token))).status).toBe(200);
    const u = await User.findOne({ email: 'cashier2@test.local' });
    const r = await request(app).patch(`/api/v1/users/${u!._id}`).set(auth(owner)).send({ active: false });
    expect(r.status).toBe(200);
    expect((await request(app).get('/api/v1/auth/me').set(auth(victim.token))).status).toBe(401);
    expect((await login('cashier2@test.local')).res.status).toBe(401);
  });

  it('changes password and invalidates the old one', async () => {
    const { token } = await login('manager@test.local');
    const bad = await request(app)
      .post('/api/v1/auth/change-password')
      .set(auth(token))
      .send({ currentPassword: 'nope-nope1', newPassword: 'NewPassw0rd!' });
    expect(bad.status).toBe(400);
    const ok = await request(app)
      .post('/api/v1/auth/change-password')
      .set(auth(token))
      .send({ currentPassword: 'Passw0rd!x', newPassword: 'NewPassw0rd!' });
    expect(ok.status).toBe(200);
    expect((await login('manager@test.local')).res.status).toBe(401);
    expect((await login('manager@test.local', 'NewPassw0rd!')).res.status).toBe(200);
  });
});

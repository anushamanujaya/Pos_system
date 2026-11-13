import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { demoIdentityHash, DEMO_ACCOUNTS } from '../src/config/demo';
import { env } from '../src/config/env';
import { permissionsFor } from '../src/config/permissions';
import { DemoEnvironment, User } from '../src/database/models';
import { hashPassword } from '../src/modules/auth/auth.service';
import { app, auth, PASSWORD, startDb, stopDb } from './helpers';

const identity = 'test-demo-identity-123456789';
let databaseName = '';
let original: Pick<typeof env, 'demoMode' | 'MONGODB_URI' | 'DEMO_DATABASE_NAME' | 'DEMO_DATABASE_ID'>;

const demoRequest = (role: string, cookie?: string) => {
  const req = request(app)
    .post('/api/v1/auth/demo')
    .set('X-Requested-With', 'pos-web')
    .send({ role });
  return cookie ? req.set('Cookie', cookie) : req;
};

beforeAll(async () => {
  databaseName = await startDb();
  original = {
    demoMode: env.demoMode,
    MONGODB_URI: env.MONGODB_URI,
    DEMO_DATABASE_NAME: env.DEMO_DATABASE_NAME,
    DEMO_DATABASE_ID: env.DEMO_DATABASE_ID,
  };
  env.demoMode = true;
  env.DEMO_DATABASE_NAME = databaseName;
  env.DEMO_DATABASE_ID = identity;
  env.MONGODB_URI = `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/${databaseName}`;
  await DemoEnvironment.create({ _id: 'demo-environment', identityHash: demoIdentityHash(identity) });
  const passwordHash = await hashPassword(PASSWORD);
  await User.create(
    (Object.entries(DEMO_ACCOUNTS) as [keyof typeof DEMO_ACCOUNTS, string][]).map(([role, email]) => ({
      name: `${role} Demo`,
      email,
      role,
      passwordHash,
      isDemoAccount: true,
      mustChangePassword: false,
    })),
  );
  await User.create({
    name: 'Normal User',
    email: 'normal@test.local',
    role: 'CASHIER',
    passwordHash,
  });
});

afterAll(async () => {
  Object.assign(env, original);
  await stopDb();
});

describe('one-click demo access', () => {
  for (const role of ['OWNER', 'MANAGER', 'CASHIER'] as const) {
    it(`issues a verified ${role.toLowerCase()} demo session`, async () => {
      const response = await demoRequest(role);
      expect(response.status).toBe(200);
      expect(response.body.data.user).toMatchObject({
        role,
        email: DEMO_ACCOUNTS[role],
        isDemo: true,
        permissions: permissionsFor(role),
      });
      expect(response.body.data.accessToken).toBeTypeOf('string');
      expect(response.headers['set-cookie']?.[0]).toContain('pos_refresh=');
    });
  }

  it('rotates to another role and revokes the previous demo session family', async () => {
    const owner = await demoRequest('OWNER');
    const oldCookie = (owner.headers['set-cookie'] as unknown as string[])[0];
    const switched = await demoRequest('CASHIER', oldCookie);
    expect(switched.status).toBe(200);
    expect(switched.body.data.user.role).toBe('CASHIER');
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', oldCookie)
          .set('X-Requested-With', 'pos-web')
      ).status,
    ).toBe(401);
    const newCookie = (switched.headers['set-cookie'] as unknown as string[])[0];
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', newCookie)
          .set('X-Requested-With', 'pos-web')
      ).body.data.user.role,
    ).toBe('CASHIER');
  });

  it('keeps server-side permissions isolated between roles', async () => {
    const owner = await demoRequest('OWNER');
    const cashier = await demoRequest('CASHIER');
    expect((await request(app).get('/api/v1/users').set(auth(owner.body.data.accessToken))).status).toBe(200);
    expect((await request(app).get('/api/v1/users').set(auth(cashier.body.data.accessToken))).status).toBe(403);
    expect((await request(app).get('/api/v1/reports/dashboard').set(auth(cashier.body.data.accessToken))).status).toBe(403);
  });

  it('logs out a demo session using the normal secure logout flow', async () => {
    const login = await demoRequest('MANAGER');
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0];
    expect(
      (
        await request(app)
          .post('/api/v1/auth/logout')
          .set('Cookie', cookie)
          .set('X-Requested-With', 'pos-web')
      ).status,
    ).toBe(200);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/refresh')
          .set('Cookie', cookie)
          .set('X-Requested-With', 'pos-web')
      ).status,
    ).toBe(401);
  });

  it('leaves normal password login functional and non-demo', async () => {
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'normal@test.local', password: PASSWORD });
    expect(response.status).toBe(200);
    expect(response.body.data.user.isDemo).toBe(false);
  });

  it('is disabled without explicit configuration', async () => {
    env.demoMode = false;
    expect((await demoRequest('OWNER')).status).toBe(403);
    env.demoMode = true;
  });

  it('is blocked when the configured database identity is wrong', async () => {
    env.DEMO_DATABASE_NAME = 'customer_production';
    expect((await demoRequest('OWNER')).status).toBe(403);
    env.DEMO_DATABASE_NAME = databaseName;
    env.DEMO_DATABASE_ID = 'wrong-demo-identity-12345';
    expect((await demoRequest('OWNER')).status).toBe(403);
    env.DEMO_DATABASE_ID = identity;
  });

  it('rejects arbitrary roles and caller-supplied account identifiers', async () => {
    expect((await demoRequest('ADMIN')).status).toBe(400);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/demo')
          .set('X-Requested-With', 'pos-web')
          .send({ role: 'OWNER', email: 'victim@example.com' })
      ).status,
    ).toBe(400);
  });
});

import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import serverlessApp from '../src/app';
import { env } from '../src/config/env';
import { disconnectDb } from '../src/database/connect';
import { User } from '../src/database/models';
import { ensureBase } from '../src/database/initAdmin';
import { hashPassword } from '../src/modules/auth/auth.service';

const original = {
  uri: env.MONGODB_URI,
  demoMode: env.demoMode,
  origins: [...env.corsOrigins],
  isVercel: env.isVercel,
};
const password = 'DeploymentTest123!';
let ownerToken = '';

beforeAll(async () => {
  await disconnectDb();
  const supplied = inject('mongoUri');
  const base = supplied.replace(/\/?(\?.*)?$/, '');
  const query = supplied.includes('?') ? supplied.slice(supplied.indexOf('?')) : '';
  env.MONGODB_URI = `${base}/deployment_${Date.now()}${query}`;
  env.demoMode = false;
  env.corsOrigins.splice(0, env.corsOrigins.length, 'https://frontend.example.test');

  // The first health request must initialize MongoDB in the same way as a cold Vercel function.
  const health = await request(serverlessApp).get('/api/health');
  expect(health.status).toBe(200);
  expect(health.body).toEqual({ status: 'ok', db: 'up' });

  await ensureBase();
  await User.create({
    name: 'Deployment Owner',
    email: 'deployment-owner@test.local',
    role: 'OWNER',
    passwordHash: await hashPassword(password),
  });
  const login = await request(serverlessApp)
    .post('/api/v1/auth/login')
    .send({ email: 'deployment-owner@test.local', password });
  ownerToken = login.body.data.accessToken;
});

afterAll(async () => {
  await mongoose.connection.dropDatabase();
  await disconnectDb();
  env.MONGODB_URI = original.uri;
  env.demoMode = original.demoMode;
  env.corsOrigins.splice(0, env.corsOrigins.length, ...original.origins);
  env.isVercel = original.isVercel;
});

describe('Vercel deployment behavior', () => {
  it('returns healthy only after a real database connection and ping', async () => {
    const response = await request(serverlessApp).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('allows the exact configured frontend origin with credentials', async () => {
    const response = await request(serverlessApp)
      .options('/api/v1/auth/demo')
      .set('Origin', 'https://frontend.example.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('https://frontend.example.test');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an origin that is not explicitly configured', async () => {
    const response = await request(serverlessApp)
      .options('/api/v1/auth/demo')
      .set('Origin', 'https://attacker.example.test')
      .set('Access-Control-Request-Method', 'POST');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CORS_ORIGIN_DENIED');
  });

  it('does not accept local-disk image uploads on Vercel', async () => {
    env.isVercel = true;
    const response = await request(serverlessApp)
      .post('/api/v1/settings/logo')
      .set('Authorization', `Bearer ${ownerToken}`);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('UPLOAD_STORAGE_UNAVAILABLE');
    env.isVercel = original.isVercel;
  });
});

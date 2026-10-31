import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const cachedMongod = path.resolve(
  __dirname,
  'node_modules/.cache/mongodb-memory-server/mongod-x64-win32-7.0.24.exe',
);
const mongoEnv = fs.existsSync(cachedMongod)
  ? { MONGOMS_SYSTEM_BINARY: cachedMongod, MONGOMS_VERSION: '7.0.24' }
  : {};

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    ...(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {}),
  },
  webServer: [
    {
      command: 'npm run e2e:stack', cwd: 'backend',
      url: 'http://localhost:4100/api/health',
      timeout: 120_000,
      reuseExistingServer: false,
      env: { ...mongoEnv, E2E_API_PORT: '4100' } as Record<string, string>,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      cwd: 'frontend',
      url: 'http://localhost:5174',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { API_PORT: '4100' },
    },
  ],
});

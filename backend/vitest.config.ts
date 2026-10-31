import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Reuse an already-downloaded mongod (MONGOMS_SYSTEM_BINARY) if present; otherwise mongodb-memory-server downloads one.
const cached = path.resolve(__dirname, '.mongo-bin/mongod.exe');
const systemBinary = process.env.MONGOMS_SYSTEM_BINARY ?? (fs.existsSync(cached) ? cached : undefined);

// globalSetup runs in the main process, which does not receive `test.env`
if (systemBinary) {
  process.env.MONGOMS_SYSTEM_BINARY = systemBinary;
  process.env.MONGOMS_VERSION = '7.0.24';
}

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/globalSetup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    include: ['tests/**/*.test.ts'],
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-123',
      ...(systemBinary ? { MONGOMS_SYSTEM_BINARY: systemBinary, MONGOMS_VERSION: '7.0.24' } : {}),
    },
  },
});

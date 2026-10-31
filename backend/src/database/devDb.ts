/**
 * Starts a persistent single-node MongoDB replica set for local development (no Docker needed).
 * Data is kept in ./.mongo-data. The first run downloads a MongoDB binary.
 */
import path from 'node:path';
import fs from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

async function main() {
  const dbPath = path.resolve(__dirname, '../../.mongo-data');
  fs.mkdirSync(dbPath, { recursive: true });
  const rs = await MongoMemoryReplSet.create({
    instanceOpts: [{ port: 27017, dbPath }],
    replSet: { name: 'rs0', count: 1, dbName: 'supermarket_pos', storageEngine: 'wiredTiger' },
  });
   
  console.log(`Dev replica set ready.\nMONGODB_URI=${rs.getUri('supermarket_pos')}`);
  const stop = async () => {
    await rs.stop({ doCleanup: false });
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});

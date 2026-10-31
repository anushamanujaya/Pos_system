import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

let rs: MongoMemoryReplSet | undefined;

/** One in-memory MongoDB replica set (transactions need a replica set) shared by all test files; each file uses its own database. */
export async function setup(project: TestProject) {
  rs = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  project.provide('mongoUri', rs.getUri());
}

export async function teardown() {
  await rs?.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

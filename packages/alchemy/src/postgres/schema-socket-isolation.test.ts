/** Run this file alone to detect a socket suite that mutates Bun's process-wide module cache. */
import { expect, test } from 'bun:test';
import * as PgClient from '@effect/sql-pg/PgClient';

const originalPoolFactory = PgClient.layer;
await import('./schema-socket.test.ts');

test('loading the socket suite preserves the real pool factory for other consumers', () => {
  expect(PgClient.layer).toBe(originalPoolFactory);
});

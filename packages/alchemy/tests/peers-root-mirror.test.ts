/**
 * The kit tests the tree its consumers get: every override the published consumer contract
 * (`homeflare.consumer.overrides`) shares with the repo root `overrides` must be equal, and the two
 * alchemy SQL pins (ledger row kit-contract-effect-402) must be mirrored at the root. Split out of
 * peers.test.ts (file-length cap). GLM 5.3 read of PR 376: nothing policed this fourth copy, so a
 * root bump could drift the kit off its consumers' tree with every gate green.
 */
import { expect, test } from 'bun:test';

type Overrides = Record<string, string>;
const kitPkg = (await Bun.file(new URL('../package.json', import.meta.url)).json()) as {
  homeflare: { consumer: { overrides: Overrides } };
};
const rootPkg = (await Bun.file(new URL('../../../package.json', import.meta.url)).json()) as {
  overrides?: Overrides;
};
const consumer = kitPkg.homeflare.consumer.overrides;
const root = rootPkg.overrides ?? {};

test('the root overrides mirror the alchemy SQL pins the contract carries', () => {
  for (const name of ['@effect/sql-d1', '@effect/sql-sqlite-do']) {
    expect(consumer[name] ?? '').toBe('4.0.1');
    expect(root[name] ?? '').toBe(consumer[name] ?? 'missing');
  }
});

test('every override the contract shares with the root has the same version', () => {
  const shared = Object.keys(consumer).filter((name) => name in root);
  expect(shared.length).toBeGreaterThan(0);
  for (const name of shared) expect(`${name}@${root[name]}`).toBe(`${name}@${consumer[name]}`);
});

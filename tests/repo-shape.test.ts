/**
 * The gate. This repository's tooling files are the ones `repo-shape.ts` renders.
 *
 * ★ A TEST RATHER THAN A STEP IN `check`. `bun run check` already ends in `bun test`, so
 *   the drift check costs no new lane and a failure reads the same way locally as in CI.
 * ⚠️ IT REPORTS, IT DOES NOT REPAIR — the same contract as `checkProject` in this package.
 *   The fix is `bun run repo-shape:refresh`, which the failure message names.
 */
import { expect, test } from 'bun:test';
import { driftInRepoShape } from '../packages/config/src/repo-shape.ts';
import { shape } from '../repo-shape.ts';

test('the tooling files are the ones @homeflare/config renders', async () => {
  const report = await driftInRepoShape(`${import.meta.dir}/..`, shape);
  expect(report.problems).toEqual([]);
});

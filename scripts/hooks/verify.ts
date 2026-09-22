/**
 * The pre-push gate: everything CI will run, run first.
 *
 * ★ WHY THE FULL VERIFY AND NOT JUST TESTS. This includes the consumer smoke test, which
 *   packs the real tarball and installs it — the only check that catches a package the
 *   consumers cannot install. It caught exactly that on 2026-09-15, when every other gate
 *   was green and the tarball held nothing but export names.
 *
 * ⚠️ IT TAKES ~30 SECONDS, and that is the trade: 30s here against a red PR and a
 *   round-trip. `git push --no-verify` skips it when you genuinely need to.
 */
import { fail, ok, run } from './lib.ts';

console.error('running bun run verify (lint · types · build · tests · smoke)…\n');

if ((await run(['bun', 'run', 'verify'])) !== 0) {
  fail(
    'verify failed — CI would fail the same way',
    'fix it, or `git push --no-verify` if you know why it is wrong',
  );
}

ok('verify passed — CI should agree');

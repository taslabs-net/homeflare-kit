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

// 🔴 WITHOUT `env`, THIS HANDS THE TEST SUITE THIS HOOK'S GIT_DIR. Measured 2026-09-22:
//   git exports GIT_DIR and GIT_INDEX_FILE to a hook, `verify` runs `bun test`, and a
//   test that builds a throwaway git repository then commits into THIS repository —
//   `cwd` is ignored once GIT_DIR is set. Two junk files and a stray commit reached main
//   that way. @homeflare/config's shared pre-push does the same thing; this is the copy
//   of it that only this repository runs.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

if ((await run(['bun', 'run', 'verify'], env)) !== 0) {
  fail(
    'verify failed — CI would fail the same way',
    'fix it, or `git push --no-verify` if you know why it is wrong',
  );
}

ok('verify passed — CI should agree');

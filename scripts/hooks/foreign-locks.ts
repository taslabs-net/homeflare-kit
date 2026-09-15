/**
 * Refuse a lockfile from another package manager.
 *
 * ⛔ THIS REPO IS BUN-ONLY, AND A SECOND LOCKFILE IS A FAILED INSTALL, NOT A PEER. Two
 *   resolvers disagreeing about one dependency graph is exactly the drift this repo
 *   exists to prevent for everyone else.
 * ⚠️ The usual cause is muscle memory — `npm install` to add one package — and the
 *   symptom is not an error but a second CI result that mysteriously differs.
 */
import { fail, ok, stagedFiles } from './lib.ts';

const FOREIGN = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'npm-shrinkwrap.json',
]);

const staged = await stagedFiles();
const found = staged.filter((f) => FOREIGN.has(f.split('/').pop() ?? ''));

if (found.length > 0) {
  console.error(found.map((f) => `  ${f}`).join('\n'));
  fail(
    'a foreign lockfile is staged — this repo installs with bun only',
    `git rm --cached ${found.join(' ')} && rm ${found.join(' ')} && bun install`,
  );
}

ok('no foreign lockfiles');

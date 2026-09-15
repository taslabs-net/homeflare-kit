/**
 * Refuse to commit anything that looks like a credential.
 *
 * ⛔ FIRST GATE, ALWAYS. A secret that reaches a public repo is compromised the moment it
 *   is pushed — rotating it is the only remedy, and rewriting history does not help
 *   because the object is already fetched and mirrored. Every other check can be fixed
 *   after the fact; this one cannot.
 *
 * ★ gitleaks IS THE TOOL, not a hand-rolled regex list. It ships hundreds of maintained
 *   rules and an entropy engine; a homegrown pattern set covers the token shapes its
 *   author happened to think of and silently misses the rest.
 *
 * ⚠️ IT IS A GO BINARY, NOT AN npm PACKAGE — there is nothing to add to package.json, so
 *   a contributor who has not installed it would otherwise get a confusing failure. This
 *   script detects that case and explains, rather than failing on a missing command.
 *     macOS:  brew install gitleaks
 *     Linux:  github.com/gitleaks/gitleaks/releases
 *
 * ⚠️ `git --staged`, NOT the `protect` command. Measured 2026-09-15 on gitleaks 8.30.1:
 *   `protect` and `detect` both still run and print no deprecation warning, but the
 *   documented surface is now `gitleaks git` / `gitleaks dir` / `gitleaks stdin`. Using
 *   the current spelling means this hook does not quietly rot.
 */
import { fail, ok, run } from './lib.ts';

const which = Bun.spawn(['which', 'gitleaks'], { stdout: 'ignore', stderr: 'ignore' });

if ((await which.exited) !== 0) {
  // ⛔ NOT A SILENT SKIP. A secret scan that quietly does nothing is worse than no scan:
  //   it reads, in CI logs and in a reviewer's head, as coverage that does not exist.
  console.error('\n✗ gitleaks is not installed, so staged changes were NOT scanned.');
  console.error('  macOS: brew install gitleaks');
  console.error('  Linux: https://github.com/gitleaks/gitleaks/releases\n');
  process.exit(1);
}

// --redact so a real finding does not print the secret into a terminal scrollback,
// a CI log, or an agent's context.
const code = await run(['gitleaks', 'git', '--staged', '--redact', '--no-banner', '.']);

if (code !== 0) {
  fail(
    'gitleaks found a secret in the staged changes',
    'remove it, then ROTATE it — assume anything committed is already compromised',
  );
}

ok('gitleaks: no secrets in staged changes');

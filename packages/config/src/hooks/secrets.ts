/**
 * Refuse to commit anything that looks like a credential.
 *
 * ⛔ FIRST GATE, ALWAYS. A secret that reaches a public repository is compromised the moment
 *   it is pushed — rotating it is the only remedy, and rewriting history does not help
 *   because the object is already fetched and mirrored. Every other check can be fixed
 *   after the fact; this one cannot. Moved here from homeflare-kit's own
 *   scripts/hooks/secrets.ts (2026-09-23) so every repository commits under it, not one.
 * ★ gitleaks IS THE TOOL, not a hand-rolled regex list. It ships hundreds of maintained rules
 *   and an entropy engine, and it reads the repository's own `.gitleaks.toml` when there is
 *   one; a homegrown pattern set covers the token shapes its author thought of.
 * ⚠️ IT IS A GO BINARY, NOT AN npm PACKAGE — nothing in package.json can install it, so a
 *   missing binary is explained rather than surfacing as "command not found".
 * ⚠️ `git --staged`, NOT `protect`. Measured 2026-09-15 on gitleaks 8.30.1: `protect` still
 *   runs, but the documented surface is `gitleaks git` / `dir` / `stdin`.
 */
import { fail, ok, run } from './report.ts';

const INSTALL = 'brew install gitleaks — Linux: https://github.com/gitleaks/gitleaks/releases';

export async function scanStagedSecrets(): Promise<void> {
  // ⛔ NOT A SILENT SKIP. A secret scan that quietly does nothing is worse than none: it
  //   reads, in a log and in a reviewer's head, as coverage that does not exist.
  if (Bun.which('gitleaks') === null) {
    fail(
      'pre-commit',
      'gitleaks is not installed, so the staged changes were NOT scanned',
      INSTALL,
    );
  }
  // `--redact`, so a real finding never prints the secret into a scrollback, a CI log, or an
  // agent's context.
  const code = await run(['gitleaks', 'git', '--staged', '--redact', '--no-banner', '.']);
  if (code !== 0) {
    fail(
      'pre-commit',
      'gitleaks found a secret in the staged changes',
      'remove it, then ROTATE it — assume anything committed is already compromised',
    );
  }
  ok('pre-commit: gitleaks found no secret in the staged changes');
}

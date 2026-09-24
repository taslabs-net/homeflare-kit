/**
 * formatCaddyfile()'s Effect wiring, proven against a fake `caddy` — a tiny shell script that
 * "formats" by stripping trailing whitespace per line — so stdin-in/stdout-out plumbing, the
 * exit-code check and missing-binary detection are exercised without a real Caddy on the runner.
 * The last block runs the REAL `caddy fmt` and is skipped, its name saying why, when there is none
 * on PATH (S42: tests are Bun-native, so `Bun.which` decides, not a hand-rolled PATH search).
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layer as BunServicesLayer } from '@effect/platform-bun/BunServices';
import * as Effect from 'effect/Effect';
import { CaddyFmtFailed, CaddyFmtNotFound, formatCaddyfile } from './format.ts';

/** Only understands `fmt -`: stdin in, "formatted" stdout out — `FAIL_MARKER` fakes a bad parse. */
const FAKE_SCRIPT = `#!/bin/sh
if [ "$1" != "fmt" ] || [ "$2" != "-" ]; then
  echo "fake caddy: unexpected args: $*" >&2
  exit 2
fi
input="$(cat)"
case "$input" in
  *FAIL_MARKER*)
    echo "fake caddy: syntax error" >&2
    exit 1
    ;;
esac
printf '%s' "$input" | sed -E 's/[[:space:]]+$//'
`;

const dir = mkdtempSync(join(tmpdir(), 'hf-caddy-fmt-'));
const fakeBinary = join(dir, 'hf-fake-caddy');
writeFileSync(fakeBinary, FAKE_SCRIPT, { mode: 0o755 });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const run = (text: string, options?: Parameters<typeof formatCaddyfile>[1]) =>
  Effect.runPromise(formatCaddyfile(text, options).pipe(Effect.provide(BunServicesLayer)));

const runFailure = (text: string, options?: Parameters<typeof formatCaddyfile>[1]) =>
  Effect.runPromise(
    formatCaddyfile(text, options).pipe(Effect.provide(BunServicesLayer), Effect.flip),
  );

describe('formatCaddyfile — Effect wiring against a fake binary', () => {
  test('pipes text to stdin and returns the formatted stdout', async () => {
    // ⚠️ The fake reads stdin through `$(cat)`, which — like real shell command substitution —
    //   drops a trailing newline; that is the fake's plumbing, not formatCaddyfile()'s.
    const out = await run('foo   \nbar\t\n', { binaryPath: fakeBinary });
    expect(out).toBe('foo\nbar');
  });

  test('a non-zero exit becomes a typed CaddyFmtFailed, stderr included — never the input back', async () => {
    const failure = await runFailure('site FAIL_MARKER', { binaryPath: fakeBinary });
    expect(failure).toBeInstanceOf(CaddyFmtFailed);
    expect((failure as CaddyFmtFailed).exitCode).toBe(1);
    expect(failure.message).toContain('syntax error');
  });

  test('a missing binary fails with the typed CaddyFmtNotFound — never silently skipped', async () => {
    const missing = join(dir, 'does-not-exist-caddy');
    const failure = await runFailure('x', { binaryPath: missing });
    expect(failure).toBeInstanceOf(CaddyFmtNotFound);
    expect((failure as CaddyFmtNotFound).binaryPath).toBe(missing);
    expect(failure.message).toContain(missing);
  });

  test('the default binary name resolves through PATH, not only an absolute path', async () => {
    const pathDir = mkdtempSync(join(tmpdir(), 'hf-caddy-fmt-path-'));
    writeFileSync(join(pathDir, 'caddy'), FAKE_SCRIPT, { mode: 0o755 });
    const original = process.env['PATH'];
    // ★ Prepended, so this fake wins even when a real `caddy` also sits on PATH.
    process.env['PATH'] = `${pathDir}:${original ?? ''}`;
    try {
      expect(await run('baz  \n')).toBe('baz');
    } finally {
      process.env['PATH'] = original;
      rmSync(pathDir, { recursive: true, force: true });
    }
  });
});

const realCaddy = Bun.which('caddy');
// ⚠️ DELIBERATELY NOT `caddy fmt`'s own canonical style — no space before `{`, spaces instead of
//   a tab, and the closing brace indented — every one of which `caddy fmt` actually rewrites, so
//   `expect(formatted).not.toBe(UNFORMATTED)` below cannot pass by accident on already-formatted
//   input. (Caught in review: a tab-indented, flush-brace fixture here IS canonical caddy fmt
//   style, which would make that assertion fail on a correctly working formatCaddyfile().)
const UNFORMATTED = 'example.com{\n    reverse_proxy 127.0.0.1:8080\n    }\n';

describe('formatCaddyfile — real caddy binary', () => {
  test.skipIf(realCaddy === null)(
    realCaddy === null
      ? 'formats a known-unformatted Caddyfile (skipped: no caddy on PATH)'
      : 'formats a known-unformatted Caddyfile, and formatting twice is idempotent',
    async () => {
      const formatted = await run(UNFORMATTED);
      expect(formatted).not.toBe(UNFORMATTED);
      // ★ THE REAL PROOF IT IS FORMATTED: running caddy's own formatter over its own output changes
      //   nothing. (Never asserted against a fixed expected string — that would pin this test to
      //   one caddy build's exact formatting choices.)
      expect(await run(formatted)).toBe(formatted);
    },
  );
});

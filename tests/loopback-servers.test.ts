/**
 * Every server a test starts listens on 127.0.0.1 (or a unix socket), never the wildcard.
 *
 * 🔴 THE RACE THIS PINS, measured 2026-09-23 on macOS. `Bun.serve({ port: 0 })` binds
 *   0.0.0.0, and the kernel will hand a wildcard port-0 bind a port that another socket
 *   already holds on 127.0.0.1 — 16,373 binds in, it did. Loopback traffic then reaches the
 *   more specific listener, so a fake's own requests land on some other server: another
 *   test suite's fake when several agents run `bun test` at once, or anything on the machine
 *   listening on loopback. packages/alchemy/src/proxmox/lxc-guards.test.ts failed that way
 *   with "Transport error" on a GET to a fake that was up, and lxc-read.test.ts failed under
 *   parallel pre-push runs. A 127.0.0.1 port-0 bind is never handed a port in use there, and
 *   nothing more specific can shadow it.
 * ★ A SOURCE SCAN, because the failure is rare by nature: no run of the suite proves a bind
 *   is safe, and the wildcard is Bun's default — the one a new test reaches for.
 */
import { describe, expect, test } from 'bun:test';

const ROOT = new URL('..', import.meta.url).pathname;

/** Test files and test fakes: the only code in this repository that starts a server. */
const TEST_CODE = /(\.test\.ts|\/tests\/.+\.ts|\/fake-[^/]+\.ts)$/;

/** The argument list of the call opening at `start`, by paren depth. */
function argumentsFrom(text: string, start: number): string {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')' && --depth === 0) return text.slice(start, i + 1);
  }
  return text.slice(start);
}

/**
 * ⚠️ THREE GLOBS, NOT ONE BRACE: measured 2026-09-23, `Bun.Glob` matched nothing for
 *   `{packages/*\/src,tests}/**\/*.ts` — a brace group holding slashes — and a guard that
 *   scans no files passes forever.
 */
const WHERE = ['packages/*/src/**/*.ts', 'packages/*/tests/**/*.ts', 'tests/**/*.ts'];

async function wildcardServers(): Promise<{ scanned: number; found: string[] }> {
  const found: string[] = [];
  let scanned = 0;
  for (const pattern of WHERE) {
    for await (const path of new Bun.Glob(pattern).scan({ cwd: ROOT })) {
      if (!TEST_CODE.test(`/${path}`) || path.endsWith('loopback-servers.test.ts')) continue;
      scanned += 1;
      const text = await Bun.file(`${ROOT}${path}`).text();
      for (
        let at = text.indexOf('Bun.serve(');
        at !== -1;
        at = text.indexOf('Bun.serve(', at + 1)
      ) {
        const lineStart = text.lastIndexOf('\n', at) + 1;
        // A comment that NAMES the wildcard call (as fake-pve-lxc.ts's does) is not one.
        if (/^\s*(\/\/|\*)/.test(text.slice(lineStart, at))) continue;
        const call = argumentsFrom(text, at + 'Bun.serve'.length);
        if (!/hostname:\s*'127\.0\.0\.1'|\bunix\b/.test(call)) {
          found.push(`${path}:${String(text.slice(0, at).split('\n').length)}`);
        }
      }
    }
  }
  return { scanned, found: found.sort() };
}

describe('test servers', () => {
  test('bind 127.0.0.1 or a unix socket, never the wildcard default', async () => {
    const { scanned, found } = await wildcardServers();
    // ⛔ A scan of nothing would pass; there are well over a hundred test files.
    expect(scanned).toBeGreaterThan(100);
    expect(found).toEqual([]);
  });
});

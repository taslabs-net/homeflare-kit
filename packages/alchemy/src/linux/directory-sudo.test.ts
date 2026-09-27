/**
 * Host.Directory driven through sshSudoRunner — the exact path the homeflare-ct100 incident
 * (2026-09-27) broke: a deploy running on a Mac (darwin) targeting a Linux host over ssh dropped
 * the sudo allowlist's required `--`, because directory-lifecycle.ts's `chmodChownEnd()` read
 * `process.platform` — the Mac's own OS — instead of the runner's own declared target.
 *
 * ★ WHY A SEPARATE FILE FROM directory.test.ts. Those tests exercise the lifecycle directly
 *   against a bare fake host; these go through the REAL `sshSudoRunner` + `sudo-allowlist.ts`
 *   layer (`canonicalize`, `dirProgramProblem`), which is what actually enforces the `--` token
 *   and is what refused the live deploy with `SudoRefusedError`.
 * ⛔ NEITHER TEST BELOW READS `process.platform`. `fakeLinuxHost()` (via `fakeSudoHost()`)
 *   declares `platform: 'linux'` itself — sshRunner's own probe requires it — so this suite
 *   catches the regression on every machine that runs `bun test`, regardless of that machine's
 *   own OS. (This repo's own `check` job runs on `ubuntu-latest`, not the mini, so CI alone never
 *   reproduces the "darwin process, Linux target" split the live incident measured; this suite's
 *   fixed, declared target is what actually proves the fix, on any OS.)
 */
import { describe, expect, test } from 'bun:test';
import { reconcileDirectory } from './directory-lifecycle.ts';
import { fakeSudoHost } from './fake-sudo.ts';

describe('Host.Directory through sshSudoRunner (a Linux target)', () => {
  test('the elevated chown and chmod carry -- and the allowlist accepts them', async () => {
    const { privileged, runner } = fakeSudoHost();
    expect(runner.platform).toBe('linux'); // ★ declared by sshRunner's own uname probe.

    // A fresh create under a declared prefix: mkdir runs as root, then chown (owner/group
    // declared) also runs as root — both routed through routeExec()/elevatedExec().
    const created = await reconcileDirectory(runner, {
      group: 0,
      mode: 0o755,
      owner: 0,
      path: '/etc/systemd/system/hf-test-dir',
    });
    expect(created).toEqual({
      gid: 0,
      mode: 0o755,
      path: '/etc/systemd/system/hf-test-dir',
      uid: 0,
    });

    // A mode drift on the next reconcile routes an elevated chmod too.
    await reconcileDirectory(
      runner,
      { group: 0, mode: 0o750, owner: 0, path: '/etc/systemd/system/hf-test-dir' },
      created,
    );

    const chown = privileged().find((call) => call[0] === '/usr/bin/chown');
    const chmod = privileged().find((call) => call[0] === '/usr/bin/chmod');
    // ⛔ REGRESSION: before the fix, these two calls carried no `--` whenever `bun test` ran on a
    //   Mac, and `sudo-allowlist-dir.ts`'s `dirProgramProblem` refused them with
    //   `SudoRefusedError` — the exact failure measured against homeflare-ct100 2026-09-27.
    expect(chown).toBeDefined();
    expect(chown).toContain('--');
    expect(chmod).toBeDefined();
    expect(chmod).toContain('--');
  });
});

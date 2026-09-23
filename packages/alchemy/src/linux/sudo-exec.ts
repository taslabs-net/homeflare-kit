/**
 * `sshSudoRunner.exec()`'s root branch: the host reads that decide whether a routed-to-root
 * directory or systemctl call may actually elevate. Split out of sudo-runner.ts, which keeps only
 * the wiring. sudo-allowlist.ts's `routeExec` already decided root vs operator vs refuse from the
 * argv alone; this is the part that needs the host.
 *
 * ⛔ THE FragmentPath CHECK IS WHAT MAKES `pveproxy.service` UNREACHABLE. A vendor unit's file
 *   lives under `/usr/lib/systemd/system` or `/lib/systemd/system` — never a prefix this runner
 *   would declare — so `enable`/`start`/… on it is refused before sudo runs. A unit with NO file
 *   at all (FragmentPath empty) is let through instead of refused, because `unit-lifecycle.ts`
 *   `deleteUnit` still calls `stop`/`disable` on a unit whose file this same delete already
 *   removed a moment before — refusing that would make a second, idempotent delete pass fail.
 */
import type { ExecResult, HostRunner } from '../launchd/runner.ts';
import { SYSTEMCTL_ABS, SudoRefusedError, canonicalize, prefixOf } from './sudo-allowlist.ts';
import { type ChainExpect, assertGuardedChain } from './sudo-guard.ts';
import type { Elevate } from './sudo-write.ts';
import { parseShow } from './systemctl.ts';

const DIR_EXPECT: Readonly<Record<string, ChainExpect>> = {
  chmod: 'directory',
  chown: 'directory',
  mkdir: 'absent',
  rmdir: 'directory',
};

const fragmentPathOf = async (base: HostRunner, unit: string): Promise<string> => {
  const result = await base.exec([
    SYSTEMCTL_ABS,
    'show',
    '--no-pager',
    '-p',
    'FragmentPath',
    '--',
    unit,
  ]);
  if (result.exitCode !== 0) {
    throw new SudoRefusedError(
      `sshSudoRunner ${unit}: could not read FragmentPath (systemctl show exit ` +
        `${String(result.exitCode)}). Nothing ran as root.`,
    );
  }
  return parseShow(result.stdout).get('FragmentPath') ?? '';
};

/** `argv` has already been routed to root; canonicalise it and run the read this shape needs. */
export const elevatedExec = (
  base: HostRunner,
  elevate: Elevate,
  prefixes: readonly string[],
  argv: readonly string[],
): Promise<ExecResult> => {
  const canonical = canonicalize(argv);
  const expect = DIR_EXPECT[argv[0] ?? ''];
  if (expect !== undefined) {
    const path = argv[argv.length - 1] ?? '';
    const prefix = prefixOf(path, prefixes);
    return elevate(canonical, {}, async () => {
      // ★ routeExec already required a prefix to route here; this re-derives it rather than
      //   trust the caller, so a future routing bug fails the guard instead of skipping it.
      if (prefix === undefined) {
        throw new SudoRefusedError(
          `sshSudoRunner ${path}: not under a declared prefix. Nothing ran as root.`,
        );
      }
      await assertGuardedChain(base, prefix, path, expect);
    });
  }
  if (canonical[0] !== SYSTEMCTL_ABS || canonical[1] === 'daemon-reload') return elevate(canonical);
  const unit = canonical[3] ?? '';
  return elevate(canonical, {}, async () => {
    const fragmentPath = await fragmentPathOf(base, unit);
    if (fragmentPath !== '' && prefixOf(fragmentPath, prefixes) === undefined) {
      throw new SudoRefusedError(
        `sshSudoRunner ${unit}: FragmentPath ${fragmentPath} is outside every declared prefix ` +
          `(${prefixes.join(', ')}); refusing to touch a unit this runner does not own. Nothing ran as root.`,
      );
    }
  });
};

/**
 * The `systemctl` subcommands the systemd family uses, over a HostRunner, plus the parser for the
 * one that returns data.
 *
 * ★ MEASURED 2026-09-22 on Debian 13, systemd 257 (257.13-1~deb13u1), read-only — nothing was
 *   enabled, started or reloaded to write this:
 *
 *   - `systemctl show -p <list> <unit>` EXITS 0 FOR A UNIT THAT DOES NOT EXIST, and answers with
 *     the properties it would have had:
 *         Id=hf-nonexistent-xyz.service   LoadState=not-found
 *         ActiveState=inactive            SubState=dead
 *         FragmentPath=                   UnitFileState=
 *     ⛔ SO THE EXIT CODE IS NOT THE ANSWER — `LoadState` is. A provider that read exit 0 as "the
 *       unit is there" would adopt a unit that does not exist and then never write its file.
 *   - The properties come back in systemd's own order, not the order asked for, so the output is a
 *     map and never positional.
 *   - `systemctl is-enabled <unknown>` exits **4** and prints `not-found`; `is-active <unknown>`
 *     exits **4** and prints `inactive`. Both are answers, not errors.
 *   - `UnitFileState=static` is exactly systemd's name for a unit file with no `[Install]` section
 *     (measured: the journal daemon is `static`, the ssh daemon is `enabled`).
 *   - `/etc/systemd/system` is `root:root 0755` — the admin drop-in directory, ahead of the
 *     vendor's `/usr/lib/systemd/system` in systemd's own search order.
 * ⚠️ REASONED, NOT MEASURED: the write subcommands. `daemon-reload`, `enable`, `disable`, `start`,
 *   `stop` and `restart` were never run for this file, because running them would change a live
 *   host. Each is therefore checked the same way: exit 0 or an Error carrying systemd's stderr, and
 *   the state is read back with `show` afterwards rather than assumed.
 * ⛔ NEVER PUT `show` STDOUT WITH NO PROPERTY FILTER IN AN ERROR: the unfiltered property set
 *   carries the unit's whole environment block.
 */
import type { HostRunner } from '../launchd/runner.ts';

export const SYSTEMCTL = 'systemctl';

/** The properties every read asks for. ⛔ Never `Environment` — see the header. */
export const SHOW_PROPERTIES = [
  'Id',
  'LoadState',
  'ActiveState',
  'SubState',
  'UnitFileState',
  'FragmentPath',
  'NeedDaemonReload',
] as const;

export class SystemctlError extends Error {
  constructor(command: string, exitCode: number, stderr: string) {
    super(`systemctl ${command} -> ${String(exitCode)}: ${stderr.trim().slice(0, 300)}`);
    this.name = 'SystemctlError';
  }
}

export type UnitStatus = {
  /** `loaded`, `not-found`, `masked`, `error`, `bad-setting`. ⛔ The authority on existence. */
  readonly loadState: string;
  /** systemd knows this unit: it has a unit file or is loaded. */
  readonly known: boolean;
  readonly activeState: string;
  readonly subState?: string;
  /** `enabled`, `disabled`, `static`, `masked`, … Empty for a unit with no unit file. */
  readonly unitFileState?: string;
  /** The unit file systemd would read. Empty when there is none. */
  readonly fragmentPath?: string;
  /** systemd's own view that its on-disk unit files are newer than what it has loaded. */
  readonly needDaemonReload: boolean;
};

/** `key=value` lines into a map. ⚠️ First wins: systemd never repeats a key, a truncated read might. */
export const parseShow = (stdout: string): Map<string, string> => {
  const fields = new Map<string, string>();
  for (const line of stdout.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at);
    if (!fields.has(key)) fields.set(key, line.slice(at + 1));
  }
  return fields;
};

export const statusOf = (stdout: string): UnitStatus => {
  const fields = parseShow(stdout);
  const loadState = fields.get('LoadState') ?? 'not-found';
  const unitFileState = fields.get('UnitFileState') ?? '';
  const fragmentPath = fields.get('FragmentPath') ?? '';
  const subState = fields.get('SubState') ?? '';
  return {
    activeState: fields.get('ActiveState') ?? 'inactive',
    // ⛔ MEASURED: `show` answers for a unit that does not exist, so "known" is LoadState plus
    //   whether systemd found a unit file at all — never the exit code.
    known: loadState !== 'not-found' || unitFileState !== '',
    loadState,
    needDaemonReload: fields.get('NeedDaemonReload') === 'yes',
    ...(subState === '' ? {} : { subState }),
    ...(unitFileState === '' ? {} : { unitFileState }),
    ...(fragmentPath === '' ? {} : { fragmentPath }),
  };
};

export const showUnit = async (runner: HostRunner, name: string): Promise<UnitStatus> => {
  const result = await runner.exec([
    SYSTEMCTL,
    'show',
    '--no-pager',
    '-p',
    SHOW_PROPERTIES.join(','),
    '--',
    name,
  ]);
  // ⚠️ A non-zero `show` means systemctl itself failed (no bus, a malformed name) — not a missing
  //   unit, which exits 0. Failing closed here is what keeps a broken connection from reading as
  //   "the unit is gone", which would make the next deploy write its file and restart it.
  if (result.exitCode !== 0)
    throw new SystemctlError(`show ${name}`, result.exitCode, result.stderr);
  return statusOf(result.stdout);
};

/** One write subcommand, checked. ⚠️ stderr only; `show` output never reaches an error. */
const run = async (runner: HostRunner, args: readonly string[]): Promise<void> => {
  const result = await runner.exec([SYSTEMCTL, ...args]);
  if (result.exitCode !== 0) {
    throw new SystemctlError(args.join(' '), result.exitCode, result.stderr);
  }
};

/** ⛔ After every unit-file write or removal, and before enable/start reads it. */
export const daemonReload = (runner: HostRunner): Promise<void> => run(runner, ['daemon-reload']);

export const enableUnit = (runner: HostRunner, name: string): Promise<void> =>
  run(runner, ['enable', '--', name]);

export const disableUnit = (runner: HostRunner, name: string): Promise<void> =>
  run(runner, ['disable', '--', name]);

export const startUnit = (runner: HostRunner, name: string): Promise<void> =>
  run(runner, ['start', '--', name]);

export const stopUnit = (runner: HostRunner, name: string): Promise<void> =>
  run(runner, ['stop', '--', name]);

/**
 * ⛔ `restart`, NOT `reload-or-restart`. The reloading form asks the unit to re-read its config in
 *   place when it declares `ExecReload=`, which means "did the change take effect?" has two
 *   different answers depending on the unit — and a deploy cannot report a half-applied change.
 */
export const restartUnit = (runner: HostRunner, name: string): Promise<void> =>
  run(runner, ['restart', '--', name]);

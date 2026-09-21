/**
 * The four `launchctl` subcommands LaunchdJob uses — print, print-disabled, bootstrap, bootout —
 * over a HostRunner, plus the parsers for the two read-only ones.
 *
 * ★ MEASURED 2026-09-21 ON macOS 27.2 (read-only `print` / `print-disabled` only; nothing was
 *   bootstrapped or booted out to write this):
 *   - `print system/<unknown>` exits **113** with "Could not find service … in domain for system"
 *     on stderr. 113 is therefore "not loaded", not an error.
 *   - `print` of a loaded job is a `<target> = {` block. Its own fields sit one tab deep
 *     (`\tstate = running`, `\tpid = 1219`, `\tlast exit code = 0` or `(never exited)`); nested
 *     blocks (`resource coalition`, `semaphores`) repeat names like `state` two tabs deep.
 *   - `print-disabled <domain>` lists `"label" => enabled|disabled`.
 *   - reading needs no root: a uid-501 shell printed system-domain jobs.
 * ⚠️ REASONED, NOT MEASURED: bootstrap/bootout exit codes. nix-darwin's own activation script on the
 *   same host notes "`bootout` on an already-absent job is a no-op that returns non-zero", which is
 *   why bootout here is always preceded by a print and followed by a poll, never trusted alone.
 * ⛔ NEVER PUT `print` STDOUT IN AN ERROR. It contains the job's whole environment.
 */
import type { HostRunner } from './runner.ts';

export const LAUNCHCTL = '/bin/launchctl';
/** `launchctl print` of an unknown service — measured, see above. */
export const NOT_FOUND = 113;

export class LaunchctlError extends Error {
  constructor(command: string, exitCode: number, stderr: string) {
    super(`launchctl ${command} -> ${String(exitCode)}: ${stderr.trim().slice(0, 300)}`);
    this.name = 'LaunchctlError';
  }
}

export type ServiceStatus = {
  readonly loaded: boolean;
  readonly state?: string;
  readonly pid?: number;
  readonly lastExitCode?: number;
};

/**
 * The job block's own `key = value` lines, ignoring nested blocks.
 * ⚠️ A multi-line ProgramArguments entry is printed raw inside `arguments = {`, so a close is only
 *   accepted when its indentation matches the open. An argument that itself contains a line of
 *   exactly one tab and `}` would still desynchronise this; no real job has one.
 */
export const printFields = (stdout: string): Map<string, string> => {
  const fields = new Map<string, string>();
  const closers: string[] = [];
  for (const line of stdout.split('\n')) {
    if (closers.length === 0) {
      if (fields.size === 0 && line.endsWith(' = {')) closers.push('}');
      continue;
    }
    if (line === closers[closers.length - 1]) {
      closers.pop();
      continue;
    }
    const opened = /^(\t+)\S.* = \{$/.exec(line);
    if (opened?.[1] !== undefined && opened[1].length === closers.length) {
      closers.push(`${opened[1]}}`);
      continue;
    }
    const field = closers.length === 1 ? /^\t([a-z][a-z ]*[a-z]) = (.*)$/.exec(line) : null;
    if (field?.[1] !== undefined && field[2] !== undefined && !fields.has(field[1])) {
      fields.set(field[1], field[2]);
    }
  }
  return fields;
};

const leadingInt = (text: string | undefined): number | undefined => {
  const match = text === undefined ? null : /^(-?\d+)/.exec(text);
  return match?.[1] === undefined ? undefined : Number(match[1]);
};

export const parsePrint = (stdout: string): ServiceStatus => {
  const fields = printFields(stdout);
  const state = fields.get('state');
  const pid = leadingInt(fields.get('pid'));
  // "(never exited)" parses to undefined; "78: EX_CONFIG" to 78.
  const lastExitCode = leadingInt(fields.get('last exit code'));
  return {
    loaded: true,
    ...(state === undefined ? {} : { state }),
    ...(pid === undefined ? {} : { pid }),
    ...(lastExitCode === undefined ? {} : { lastExitCode }),
  };
};

/** Labels `print-disabled` reports as disabled. Older releases printed `=> true` for disabled. */
export const parseDisabled = (stdout: string): Set<string> => {
  const disabled = new Set<string>();
  for (const match of stdout.matchAll(/^\s*"([^"]+)" => (\w+)\s*$/gm)) {
    if (match[1] !== undefined && (match[2] === 'disabled' || match[2] === 'true')) {
      disabled.add(match[1]);
    }
  }
  return disabled;
};

export const printService = async (runner: HostRunner, target: string): Promise<ServiceStatus> => {
  const result = await runner.exec([LAUNCHCTL, 'print', target]);
  if (result.exitCode === NOT_FOUND) return { loaded: false };
  if (result.exitCode !== 0)
    throw new LaunchctlError(`print ${target}`, result.exitCode, result.stderr);
  return parsePrint(result.stdout);
};

export const isDisabled = async (
  runner: HostRunner,
  domain: string,
  label: string,
): Promise<boolean> => {
  const result = await runner.exec([LAUNCHCTL, 'print-disabled', domain]);
  if (result.exitCode !== 0) {
    throw new LaunchctlError(`print-disabled ${domain}`, result.exitCode, result.stderr);
  }
  return parseDisabled(result.stdout).has(label);
};

export const bootstrap = async (
  runner: HostRunner,
  domain: string,
  plistPath: string,
): Promise<void> => {
  const result = await runner.exec([LAUNCHCTL, 'bootstrap', domain, plistPath]);
  if (result.exitCode !== 0) {
    throw new LaunchctlError(`bootstrap ${domain} ${plistPath}`, result.exitCode, result.stderr);
  }
};

/**
 * Poll `print` until the service is gone. ⚠️ bootout can return before launchd lets go of it.
 * ★ 30 s, because a job gets SIGTERM and then its ExitTimeOut before SIGKILL: launchd.plist(5)
 *   documents a 20 s default (a macOS 27.2 `print` showed `exit timeout = 5` for a job that sets
 *   none). Giving up sooner would fail a deploy over a job that was, correctly, still exiting.
 */
export const waitUnloaded = async (
  runner: HostRunner,
  target: string,
  attempts = 120,
  intervalMs = 250,
): Promise<void> => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!(await printService(runner, target)).loaded) return;
    await runner.sleep(intervalMs);
  }
  throw new Error(
    `${target} is still loaded ${String((attempts * intervalMs) / 1000)}s after bootout`,
  );
};

/** Boot a service out if it is loaded, and wait until launchd has let go. Idempotent. */
export const bootoutIfLoaded = async (runner: HostRunner, target: string): Promise<void> => {
  if (!(await printService(runner, target)).loaded) return;
  const result = await runner.exec([LAUNCHCTL, 'bootout', target]);
  // ⚠️ A non-zero bootout is only an error if the service is STILL there afterwards (see header).
  if (result.exitCode !== 0 && (await printService(runner, target)).loaded) {
    throw new LaunchctlError(`bootout ${target}`, result.exitCode, result.stderr);
  }
  await waitUnloaded(runner, target);
};

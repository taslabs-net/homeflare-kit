/**
 * LaunchdJob's props, attributes and the pure half of the provider: domain parsing, the plist path,
 * and the props → plist mapping whose SHA-256 is the whole diff.
 *
 * ★ KEY NAMES AND MEANINGS FROM launchd.plist(5), checked against the 148 nix-darwin daemons on a
 *   macOS 27.2 host on 2026-09-21 (read-only, from /nix/store): Label, ProgramArguments, RunAtLoad,
 *   KeepAlive (boolean or {SuccessfulExit}), ThrottleInterval, StandardOutPath/StandardErrorPath,
 *   EnvironmentVariables, UserName, StartInterval and StartCalendarInterval are the keys in real
 *   use. Everything rarer goes through `extraKeys`.
 */
import { createHash } from 'node:crypto';
import { type PlistDict, type PlistValue, renderPlist } from './plist.ts';

/** `system` (LaunchDaemons, root) or one user's login session, `gui/<uid>` (LaunchAgents). */
export type LaunchdDomain = 'system' | `gui/${number}`;

/** One StartCalendarInterval entry. An omitted field is a wildcard, as in cron. */
export type CalendarInterval = {
  readonly minute?: number;
  readonly hour?: number;
  readonly day?: number;
  /** 0 and 7 are both Sunday. */
  readonly weekday?: number;
  readonly month?: number;
};

/** `true` = always restart; the object form restarts only on the named conditions. */
export type KeepAlive = boolean | { readonly successfulExit?: boolean; readonly crashed?: boolean };

export interface LaunchdJobProps {
  /** Reverse-DNS label. Unique per domain; also the plist's file name. */
  label: string;
  domain: LaunchdDomain;
  /** argv; the first element must be an absolute path. */
  programArguments: readonly string[];
  /**
   * ⛔ NON-SECRET VALUES ONLY. Props are stored unencrypted in Alchemy state, and these also land in
   *   the plist on disk and in `launchctl print`. Pass a secret as a FILE PATH that a secret renderer
   *   (openbao-agent) maintains — secret-tripwire.ts refuses the obvious mistakes.
   */
  environment?: Readonly<Record<string, string>>;
  runAtLoad?: boolean;
  keepAlive?: KeepAlive;
  /** Seconds between starts. */
  startInterval?: number;
  startCalendarInterval?: CalendarInterval | readonly CalendarInterval[];
  /** Minimum seconds between (re)starts; launchd's default is 10. */
  throttleInterval?: number;
  standardOutPath?: string;
  standardErrorPath?: string;
  workingDirectory?: string;
  /** Run as this user. ⚠️ System domain only — launchd ignores it for agents, so it is refused. */
  userName?: string;
  /** Run as this group. ⚠️ System domain only, like `userName`. */
  groupName?: string;
  /**
   * Any other launchd.plist(5) key, verbatim (`ProcessType`, `SoftResourceLimits`, …).
   * ⛔ A key the typed props own is refused, so one job can never say two things.
   */
  extraKeys?: PlistDict;
}

export interface LaunchdJobAttributes {
  label: string;
  domain: LaunchdDomain;
  /** `<domain>/<label>` — what `launchctl print` / `bootout` take. */
  serviceTarget: string;
  plistPath: string;
  /** SHA-256 of the plist bytes last bootstrapped (reconcile) or found on disk (read). */
  plistSha256: string;
  /** Bootstrapped into the domain — not necessarily running. */
  loaded: boolean;
  /** launchd's own word: `running`, `not running`, … */
  state?: string;
  pid?: number;
  lastExitCode?: number;
}

export type ParsedDomain =
  | { readonly kind: 'system' }
  | { readonly kind: 'gui'; readonly uid: number };

export const parseDomain = (domain: string): ParsedDomain | undefined => {
  if (domain === 'system') return { kind: 'system' };
  const match = /^gui\/(\d+)$/.exec(domain);
  return match?.[1] === undefined ? undefined : { kind: 'gui', uid: Number(match[1]) };
};

export const serviceTarget = (label: string, domain: LaunchdDomain): string => `${domain}/${label}`;

/**
 * Where launchd expects the job's plist. ★ Derived, never declared: a daemon's plist outside
 *   /Library/LaunchDaemons is not bootstrapped at boot, so a free-form path would be a job that
 *   silently stops existing after the next restart.
 */
export const plistPathFor = (
  label: string,
  domain: ParsedDomain,
  home: string | undefined,
): string => {
  if (domain.kind === 'system') return `/Library/LaunchDaemons/${label}.plist`;
  // ⛔ No `~` fallback: the provider may run as root, whose `~` is not the agent owner's home.
  if (home === undefined || !home.startsWith('/')) {
    throw new Error(`gui/${String(domain.uid)}: no home directory for that uid on this host`);
  }
  return `${home}/Library/LaunchAgents/${label}.plist`;
};

/** Plist keys the typed props own — `extraKeys` may not name them. `Program` is refused too. */
export const OWNED_KEYS: readonly string[] = [
  'EnvironmentVariables',
  'GroupName',
  'KeepAlive',
  'Label',
  'Program',
  'ProgramArguments',
  'RunAtLoad',
  'StandardErrorPath',
  'StandardOutPath',
  'StartCalendarInterval',
  'StartInterval',
  'ThrottleInterval',
  'UserName',
  'WorkingDirectory',
];

const calendarDict = (entry: CalendarInterval): PlistDict => {
  const dict: Record<string, PlistValue> = {};
  if (entry.minute !== undefined) dict['Minute'] = entry.minute;
  if (entry.hour !== undefined) dict['Hour'] = entry.hour;
  if (entry.day !== undefined) dict['Day'] = entry.day;
  if (entry.weekday !== undefined) dict['Weekday'] = entry.weekday;
  if (entry.month !== undefined) dict['Month'] = entry.month;
  return dict;
};

const keepAliveValue = (keepAlive: KeepAlive): PlistValue => {
  if (typeof keepAlive === 'boolean') return keepAlive;
  const dict: Record<string, PlistValue> = {};
  if (keepAlive.successfulExit !== undefined) dict['SuccessfulExit'] = keepAlive.successfulExit;
  if (keepAlive.crashed !== undefined) dict['Crashed'] = keepAlive.crashed;
  return dict;
};

/** The plist dict for a job. ⚠️ Assumes jobProblems() came back empty. */
export const jobPlistDict = (props: LaunchdJobProps): PlistDict => {
  const dict: Record<string, PlistValue> = { ...props.extraKeys };
  dict['Label'] = props.label;
  dict['ProgramArguments'] = [...props.programArguments];
  const env = props.environment ?? {};
  if (Object.keys(env).length > 0) dict['EnvironmentVariables'] = { ...env };
  if (props.runAtLoad !== undefined) dict['RunAtLoad'] = props.runAtLoad;
  if (props.keepAlive !== undefined) dict['KeepAlive'] = keepAliveValue(props.keepAlive);
  if (props.startInterval !== undefined) dict['StartInterval'] = props.startInterval;
  const calendar = props.startCalendarInterval;
  if (calendar !== undefined) {
    dict['StartCalendarInterval'] = Array.isArray(calendar)
      ? (calendar as readonly CalendarInterval[]).map(calendarDict)
      : calendarDict(calendar as CalendarInterval);
  }
  if (props.throttleInterval !== undefined) dict['ThrottleInterval'] = props.throttleInterval;
  if (props.standardOutPath !== undefined) dict['StandardOutPath'] = props.standardOutPath;
  if (props.standardErrorPath !== undefined) dict['StandardErrorPath'] = props.standardErrorPath;
  if (props.workingDirectory !== undefined) dict['WorkingDirectory'] = props.workingDirectory;
  if (props.userName !== undefined) dict['UserName'] = props.userName;
  if (props.groupName !== undefined) dict['GroupName'] = props.groupName;
  return dict;
};

export const sha256Hex = (bytes: Uint8Array | string): string =>
  createHash('sha256').update(bytes).digest('hex');

/** The rendered plist and its digest — the only thing LaunchdJob compares. */
export const renderJob = (
  props: LaunchdJobProps,
): { text: string; bytes: Uint8Array; sha256: string } => {
  const text = renderPlist(jobPlistDict(props));
  const bytes = new TextEncoder().encode(text);
  return { bytes, sha256: sha256Hex(bytes), text };
};

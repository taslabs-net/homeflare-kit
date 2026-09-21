/**
 * Everything LaunchdJob refuses before it touches the host. Run at plan time (diff) and again at
 * reconcile, so a bad declaration fails the plan instead of half-applying.
 *
 * ★ REFUSE WHAT launchd WOULD SILENTLY IGNORE OR MISREAD. launchd loads a plist with an out-of-range
 *   calendar field or a UserName on an agent without complaint and then simply never does what the
 *   declaration says; a plan that fails is cheaper than a job that quietly does nothing.
 */
import {
  type CalendarInterval,
  type LaunchdJobProps,
  OWNED_KEYS,
  parseDomain,
} from './job-form.ts';
import { jobSecretProblems } from './secret-tripwire.ts';

/** ★ Labels become file names: no `/`, no leading dot, nothing a path could re-interpret. */
export const LABEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

/**
 * ⛔ LABELS OTHER TOOLS OWN ARE NEVER DECLARED HERE. nix-darwin (`org.nixos.*`) rewrites its plists
 *   on every activation and unloads any it no longer lists; macOS owns `com.apple.*`; `brew
 *   services` owns `homebrew.mxcl.*`. Declaring one of those makes two tools fight over one file.
 *   To move a job off such a tool, declare a NEW label and cut over (docs/launchd.md).
 */
export const RESERVED_LABEL_PREFIXES: readonly string[] = [
  'org.nixos.',
  'com.apple.',
  'homebrew.mxcl.',
];

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

const RANGES: ReadonlyArray<readonly [keyof CalendarInterval, number, number]> = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day', 1, 31],
  ['weekday', 0, 7],
  ['month', 1, 12],
];

const isInt = (value: number, min: number, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= min && value <= max;

const calendarProblems = (entries: readonly CalendarInterval[]): string[] => {
  if (entries.length === 0) return ['startCalendarInterval is an empty list; omit it instead'];
  const found: string[] = [];
  for (const [index, entry] of entries.entries()) {
    for (const [field, min, max] of RANGES) {
      const value = entry[field];
      if (value !== undefined && !isInt(value, min, max)) {
        found.push(
          `startCalendarInterval[${String(index)}].${field} must be ${String(min)}–${String(max)}`,
        );
      }
    }
  }
  return found;
};

const absolute = (name: string, value: string | undefined): string[] =>
  value === undefined || value.startsWith('/') ? [] : [`${name} must be an absolute path`];

/**
 * The label and domain alone — the job's identity. ★ Split out because a rename is a delete-first
 *   replace, and it must be refusable at plan time even while other props are still unresolved
 *   Outputs (see job.ts diff): otherwise the old job is deleted and only then is the new label
 *   found to be invalid.
 */
export const identityProblems = (label: string, domainText: string): string[] => {
  const found: string[] = [];
  if (!LABEL.test(label)) {
    found.push('label must be 1–200 of [A-Za-z0-9._-], starting with a letter or digit');
  }
  const reserved = RESERVED_LABEL_PREFIXES.find((prefix) => label.startsWith(prefix));
  if (reserved !== undefined) {
    found.push(`label ${label} is under ${reserved}, which another tool owns; declare a new label`);
  }
  if (parseDomain(domainText) === undefined)
    found.push(`domain must be 'system' or 'gui/<uid>', not ${domainText}`);
  return found;
};

export const jobProblems = (props: LaunchdJobProps): string[] => {
  const found = identityProblems(props.label, props.domain);
  const domain = parseDomain(props.domain);

  const [program] = props.programArguments;
  // ★ Absolute, because launchd's PATH for a job is not the deploying shell's PATH.
  if (program === undefined) found.push('programArguments must name a program');
  else if (!program.startsWith('/')) found.push('programArguments[0] must be an absolute path');

  for (const name of Object.keys(props.environment ?? {})) {
    if (!ENV_NAME.test(name))
      found.push(`environment name ${JSON.stringify(name)} is not a valid variable name`);
  }
  found.push(...jobSecretProblems(props.environment, props.programArguments, props.extraKeys));

  if (props.startInterval !== undefined && !isInt(props.startInterval, 1)) {
    found.push('startInterval must be a positive whole number of seconds');
  }
  if (props.throttleInterval !== undefined && !isInt(props.throttleInterval, 0)) {
    found.push('throttleInterval must be a non-negative whole number of seconds');
  }
  const calendar = props.startCalendarInterval;
  if (calendar !== undefined) {
    found.push(
      ...calendarProblems(Array.isArray(calendar) ? calendar : [calendar as CalendarInterval]),
    );
  }
  const keepAlive = props.keepAlive;
  if (
    typeof keepAlive === 'object' &&
    keepAlive.successfulExit === undefined &&
    keepAlive.crashed === undefined
  ) {
    found.push('keepAlive {} names no condition; use true, false, or a condition');
  }

  found.push(...absolute('standardOutPath', props.standardOutPath));
  found.push(...absolute('standardErrorPath', props.standardErrorPath));
  found.push(...absolute('workingDirectory', props.workingDirectory));

  if (domain?.kind === 'gui' && (props.userName !== undefined || props.groupName !== undefined)) {
    found.push(
      'userName/groupName apply only to the system domain; launchd ignores them for agents',
    );
  }
  for (const key of Object.keys(props.extraKeys ?? {})) {
    if (OWNED_KEYS.includes(key))
      found.push(`extraKeys.${key} is owned by a typed prop; use that instead`);
  }
  return found;
};

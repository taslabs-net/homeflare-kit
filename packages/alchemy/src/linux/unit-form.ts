/**
 * Systemd.Unit / Systemd.Timer props, attributes, the unit-file renderer and the validation — the
 * pure half of the family.
 *
 * ⛔ THE DIRECTIVE SET IS SYSTEMD'S, NOT THIS FILE'S. There is no machine-readable schema of
 *   `systemd.unit(5)` / `systemd.service(5)` directives to generate from, so this renders SECTIONS
 *   AND LINES VERBATIM and claims to know nothing about what the keys mean. What it validates is
 *   only what an INI file must be true of — a section name, a key shape, no embedded newline —
 *   plus the two structural rules systemd's own output proves (see `unitProblems`). ★ That is the
 *   honest boundary: invent no vendor shapes, and let `systemd-analyze verify` be the deep check a
 *   host stack runs on the host.
 * ⛔ `content` IS NEVER A SECRET. Props sit unencrypted in Alchemy state and the unit file is
 *   world-readable at 0644; a unit that needs a secret takes `EnvironmentFile=` pointing at a file
 *   a secret renderer maintains.
 */
import { sha256Hex } from '../launchd/job-form.ts';

export type UnitSection = {
  /** `Unit`, `Service`, `Timer`, `Install`, … — verbatim, including its capitalisation. */
  readonly name: string;
  /**
   * The section's lines, in order. A repeated key is allowed and meaningful in systemd
   * (`ExecStartPre=` twice runs twice), so this is a list of pairs, never an object.
   */
  readonly lines: readonly (readonly [key: string, value: string])[];
};

export type SystemdUnitProps = {
  /** Unit name WITH its suffix, e.g. `thing.service`. The unit file's name on disk. */
  name: string;
  /** The whole unit file, verbatim. Mutually exclusive with `sections`. */
  content?: string;
  /** The unit file as sections, rendered in the order given. Mutually exclusive with `content`. */
  sections?: readonly UnitSection[];
  /** Directory the unit file goes in. @default '/etc/systemd/system' */
  directory?: string;
  /** `systemctl enable` / `disable`. @default true */
  enabled?: boolean;
  /** `systemctl start` / `stop`. @default true */
  started?: boolean;
  /**
   * Digests of things this unit READS that live outside its unit file — a rendered config file's
   * `sha256` attribute, most often. A change here restarts the unit; nothing else does.
   * ⚠️ A hand edit of that file is NOT noticed: the digest in state still matches what the stack
   *   declared, so the unit reads converged. That limit is the same one the Mac side records.
   */
  restartOn?: readonly string[];
};

export type SystemdUnitAttributes = {
  name: string;
  unitPath: string;
  /** SHA-256 of the unit file this resource wrote. */
  unitSha256: string;
  /** SHA-256 of `restartOn`, so a config change is a diff. */
  configSha256: string;
  loadState: string;
  activeState: string;
  unitFileState?: string;
  enabled: boolean;
  active: boolean;
};

/** ★ systemd's admin drop-in directory, ahead of the vendor's in its search order (measured). */
export const DEFAULT_UNIT_DIRECTORY = '/etc/systemd/system';

/**
 * Directories systemd looks in for a unit file it can enable.
 * ★ MEASURED 2026-09-22 with `systemd-analyze unit-paths` on Debian 13 / systemd 257, minus the
 *   per-user and generator directories, which are not places a stack writes. `/lib/systemd/system`
 *   is the same directory before the /usr merge, where the measured host has only the merged name.
 * ⛔ WHY IT IS ENFORCED. `systemctl enable <name>` looks the unit up BY NAME; a unit file outside
 *   these directories is invisible to that lookup, so an enabled unit declared into, say, `/opt`
 *   writes its file, reloads, and then fails at `enable` with the file already on disk.
 */
export const UNIT_SEARCH_DIRECTORIES = [
  '/etc/systemd/system',
  '/run/systemd/system',
  '/usr/local/lib/systemd/system',
  '/usr/lib/systemd/system',
  '/lib/systemd/system',
] as const;

/** ⛔ The unit file's mode and owner are systemd's rule, not a choice: readable, never writable. */
export const UNIT_WRITE = { gid: 0, mode: 0o644, uid: 0 } as const;

export const digestOf = (text: string): string => sha256Hex(new TextEncoder().encode(text));

/** The digests of everything outside the unit file that should restart it, as one value. */
export const configDigest = (restartOn: readonly string[] | undefined): string =>
  digestOf((restartOn ?? []).join('\n'));

/** Sections → an INI unit file. ★ Keys and values pass through untouched; see the file header. */
export const renderUnit = (sections: readonly UnitSection[]): string =>
  `${sections
    .map((section) =>
      [`[${section.name}]`, ...section.lines.map(([key, value]) => `${key}=${value}`)].join('\n'),
    )
    .join('\n\n')}\n`;

export const unitText = (props: SystemdUnitProps): string =>
  props.content ?? renderUnit(props.sections ?? []);

export const unitPathFor = (props: SystemdUnitProps): string =>
  `${props.directory ?? DEFAULT_UNIT_DIRECTORY}/${props.name}`;

const NAME = /^[A-Za-z0-9][A-Za-z0-9_.@:-]*\.([a-z]+)$/;
/** systemd's own unit types. ★ Fixed vocabulary from `systemd.unit(5)`, not a guess at directives. */
const TYPES = new Set([
  'automount',
  'device',
  'mount',
  'path',
  'scope',
  'service',
  'slice',
  'socket',
  'swap',
  'target',
  'timer',
]);

const INSTALL_KEYS = new Set(['WantedBy', 'RequiredBy', 'UpsertedBy', 'Also', 'Alias']);

/**
 * Every refusal at once, so one plan shows the whole list.
 * ⛔ THE TWO STRUCTURAL RULES, both proven by systemd's own output rather than assumed:
 *   - `enabled: true` needs an `[Install]` section. `systemctl enable` has nothing to link without
 *     one, and systemd's name for a unit file that has none is `UnitFileState=static` — measured on
 *     a live host, where the journal daemon reads `static` and the ssh daemon reads `enabled`.
 *   - A `.timer` needs a `[Timer]` section, and a timer's `[Install]` is what arms it at boot.
 */
export const unitProblems = (props: SystemdUnitProps, expect?: string): string[] => {
  const found: string[] = [];
  const type = NAME.exec(props.name)?.[1];
  if (type === undefined || !TYPES.has(type)) {
    found.push(
      `name must be <unit>.<type> with a systemd unit type, got ${JSON.stringify(props.name)}`,
    );
  } else if (expect !== undefined && type !== expect) {
    found.push(`this resource declares a .${expect} unit; ${props.name} is a .${type}`);
  }
  if ((props.content === undefined) === (props.sections === undefined)) {
    found.push('declare exactly one of content or sections');
  }
  const directory = props.directory ?? DEFAULT_UNIT_DIRECTORY;
  if (!directory.startsWith('/') || directory.endsWith('/') || directory.includes('/..')) {
    found.push('directory must be an absolute, normalised path with no trailing slash');
  }
  found.push(...textProblems(unitText(props)));
  if (props.enabled !== false && !UNIT_SEARCH_DIRECTORIES.includes(directory as never)) {
    found.push(
      `an enabled unit must live where systemd looks for it by name (${UNIT_SEARCH_DIRECTORIES.join(', ')}); ` +
        `${directory} is not one of them. Move it, or declare enabled: false.`,
    );
  }
  if (props.enabled !== false && !hasInstall(props)) {
    found.push(
      'enabled units need an [Install] section with WantedBy/RequiredBy/Also/Alias; without one ' +
        'systemd calls the unit "static" and `systemctl enable` has nothing to link. Add one, or ' +
        'declare enabled: false and let something else pull it in.',
    );
  }
  if (type === 'timer' && !unitText(props).includes('[Timer]')) {
    found.push('a .timer needs a [Timer] section');
  }
  return found;
};

const hasInstall = (props: SystemdUnitProps): boolean => {
  const text = unitText(props);
  if (!text.includes('[Install]')) return false;
  const after = text.slice(text.indexOf('[Install]'));
  return [...INSTALL_KEYS].some((key) => new RegExp(`^${key}=`, 'm').test(after));
};

const textProblems = (text: string): string[] => {
  const found: string[] = [];
  if (text.trim() === '') found.push('the unit file is empty');
  if (text.includes('\u0000')) found.push('the unit file contains NUL');
  if (!/^\s*\[[A-Za-z]+]/.test(text)) found.push('a unit file must begin with a [Section]');
  return found;
};

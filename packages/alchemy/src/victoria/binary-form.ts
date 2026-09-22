/**
 * Victoria.Binary's props, attributes and validation — the pure half of the provider.
 *
 * ⛔ NOTHING ESTATE-SPECIFIC IS A CONSTANT HERE. The install directory, owner, group and mode are
 *   the consuming stack's props; the kit knows only vendor facts (catalog.ts). A stack that keeps
 *   its binaries under `/opt/<estate>/obs/bin` says so in its own code.
 */
import type { HostFileAttributes } from '../launchd/host-file-form.ts';
import { identityProblems, pathProblems } from '../launchd/host-file-form.ts';
import type { VictoriaCatalog, VictoriaPackage, VictoriaPlatform } from './catalog.ts';
import { VICTORIA_CATALOG } from './catalog.ts';
import { releaseProblems } from './release.ts';

export interface VictoriaBinaryProps {
  /**
   * The directory the binary is written into. ⛔ It must already exist — declare it with
   * `HostDirectory` and pass that resource's `path` here, which is also what orders it first — and
   * its last segment must be `<package>-<version>`: each version gets its own directory, so an
   * upgrade is a new path (create-before-delete, never an overwrite under a running daemon) and a
   * rollback is a path. `victoriaDirectory(root, package, version)` builds it.
   */
  directory: string;
  /** The vendor archive: `victoria-metrics` (single-node), `victoria-logs`, `victoria-traces`, `vmutils`. */
  package: VictoriaPackage;
  /** The release, without the tag's `v`: `'1.151.0'`. ⛔ Only a version the catalog pins; anything else refuses. */
  version: string;
  /** The OS and CPU the archive was built for. ⚠️ Not checked against the host (docs/victoria.md). */
  platform: VictoriaPlatform;
  /**
   * The installed name, WITHOUT the vendor's `-prod` suffix: `'vmalert'` installs the archive
   * member `vmalert-prod` as `<directory>/vmalert`. Only names the catalog lists for the package.
   */
  binary: string;
  /**
   * Your own pin of the installed binary's SHA-256 — a second witness. The plan refuses unless it
   * equals the catalog's, so a kit release that changed a pin cannot change your bytes silently.
   * @default the catalog's pin alone
   */
  sha256?: string;
  /**
   * Permission bits. ⛔ Owner-executable, never group- or world-writable, never setuid, setgid or
   * sticky — a writable binary is whoever-can-write's code, run as whoever runs the daemon.
   * @default 0o755
   */
  mode?: number;
  /** User name or numeric uid. Omitted: whoever the runner writes as. */
  owner?: string | number;
  /** Group name or numeric gid. Omitted: the directory's default group. */
  group?: string | number;
}

export interface VictoriaBinaryAttributes extends HostFileAttributes {
  /** The archive the bytes came from, whole. */
  url: string;
  /** The archive member installed, by its vendor name: `vmalert-prod`. */
  member: string;
}

export const DEFAULT_BINARY_MODE = 0o755;

/** `<root>/<package>-<version>`: the directory a version's binaries live in. */
export const victoriaDirectory = (root: string, pkg: VictoriaPackage, version: string): string =>
  `${root}/${pkg}-${version}`;

/** Where a declaration puts its binary: `<directory>/<binary>`. */
export const victoriaBinaryPath = (props: {
  readonly directory: string;
  readonly binary: string;
}): string => `${props.directory}/${props.binary}`;

export const modeProblems = (mode: number): string[] => {
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) return ['mode must be 0–0o7777'];
  const found: string[] = [];
  if ((mode & 0o7000) !== 0) found.push('mode must not set setuid, setgid or sticky');
  if ((mode & 0o022) !== 0) found.push('mode must not be group- or world-writable');
  if ((mode & 0o100) === 0) found.push('mode must let the owner execute it');
  return found;
};

const HEX64 = /^[0-9a-f]{64}$/;

/** Everything wrong with a declaration, before any host or network is asked anything. */
export const binaryProblems = (
  props: VictoriaBinaryProps,
  catalog: VictoriaCatalog = VICTORIA_CATALOG,
): string[] => {
  const found = pathProblems(props.directory).map((problem) => `directory: ${problem}`);
  const release = releaseProblems(props, catalog);
  found.push(...release);
  const expected = `${props.package}-${props.version}`;
  if (!props.directory.endsWith(`/${expected}`)) {
    found.push(`directory must end in /${expected}, so each version has its own path`);
  }
  found.push(...modeProblems(props.mode ?? DEFAULT_BINARY_MODE));
  found.push(...identityProblems('owner', props.owner));
  found.push(...identityProblems('group', props.group));
  if (props.sha256 !== undefined && !HEX64.test(props.sha256)) {
    found.push('sha256 must be 64 lower-case hex digits');
  } else if (props.sha256 !== undefined && release.length === 0) {
    const entry = catalog[props.package];
    const member = entry.binaries[props.binary] ?? '';
    const pinned = entry.versions[props.version]?.[props.platform]?.members[member];
    if (pinned !== props.sha256) {
      found.push(
        `sha256 ${props.sha256} is not the catalog's pin for ${member} (${String(pinned)})`,
      );
    }
  }
  return found;
};

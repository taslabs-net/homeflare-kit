/**
 * RemoteFile's props, attributes and validation — the pure half of the provider.
 *
 * ⛔ `content` IS NEVER A SECRET, for the same reason it is not on HostFile: Alchemy stores props
 *   unencrypted, so every byte here sits in the state store and in every plan diff. A secret file
 *   stays rendered at run time by a secret renderer; a stack declares at most the PATH it writes to.
 *   secret-tripwire.ts refuses the obvious case and catches nothing subtle.
 * ★ TWO MODES, ONE RESOURCE. Without `region` this owns the whole file, exactly as HostFile does on
 *   a Mac. With `region` it owns only the lines between two markers and promises every other byte
 *   is untouched (region.ts) — which is the only way to declare a block inside a file another tool,
 *   a vendor package or a person owns.
 */
import { pathProblems } from '../launchd/host-file-form.ts';
import { fileSecretProblems } from '../launchd/secret-tripwire.ts';
import { type RegionSpec, regionProblems } from './region.ts';

export interface RemoteFileProps {
  /** Absolute path on the host. ⚠️ The parent directory must exist — declare a HostDirectory. */
  path: string;
  /** UTF-8 text: the whole file, or the region's body. ⛔ Never a secret — see the file header. */
  content: string;
  /**
   * Own a block inside a file this resource does not own, instead of the whole file.
   * ⛔ In region mode `mode`, `owner` and `group` apply ONLY to a file this resource creates: an
   *   existing file keeps the mode and ownership its owner gave it, because changing them would be
   *   a second, undeclared claim on a file we only borrowed four lines of.
   */
  region?: RegionSpec;
  /**
   * Create the file when it is absent. Region mode only; whole-file mode always creates.
   * ⛔ Default `false`: a region declared against a path that does not exist is far more often a
   *   typo (a wrong `/etc` path) than an intention, and creating it would hide the typo.
   */
  create?: boolean;
  /** Permission bits. @default 0o644 */
  mode?: number;
  /** User name or numeric uid. Omitted: whoever the runner writes as. */
  owner?: string | number;
  /** Group name or numeric gid. Omitted: the directory's default group. */
  group?: string | number;
}

export interface RemoteFileAttributes {
  path: string;
  /** SHA-256 of the WHOLE file on disk, in both modes. */
  sha256: string;
  /** SHA-256 of the part this resource owns — in region mode, of the region's body alone. */
  contentSha256: string;
  /**
   * The block this resource owns, when it owns only a block.
   * ⛔ IT IS IN THE ATTRIBUTES ON PURPOSE. Alchemy's `delete` handler is given the attributes and
   *   nothing else, and without the marker name a delete could not find the block — it could only
   *   delete the whole file, which belongs to someone else.
   */
  region?: RegionSpec;
  mode: number;
  uid: number;
  gid: number;
  size: number;
}

export const DEFAULT_MODE = 0o644;

const identityProblems = (name: string, value: string | number | undefined): string[] => {
  if (value === undefined) return [];
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0
      ? []
      : [`${name} must be a non-negative integer id`];
  }
  return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(value) || /^\d+$/.test(value)
    ? []
    : [`${name} ${JSON.stringify(value)} is not a valid user or group name`];
};

export const fileProblems = (props: RemoteFileProps): string[] => {
  const found = pathProblems(props.path);
  const mode = props.mode ?? DEFAULT_MODE;
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) found.push('mode must be 0–0o7777');
  found.push(...identityProblems('owner', props.owner));
  found.push(...identityProblems('group', props.group));
  found.push(...fileSecretProblems(props.content));
  if (props.region !== undefined) {
    found.push(...regionProblems(props.region));
    // ⛔ Say it at plan time rather than let a deploy silently ignore the prop: in region mode
    //   these describe a file we do not own, and they are honoured only for a `create`.
    if (props.create !== true && (props.mode !== undefined || props.owner !== undefined)) {
      found.push(
        'mode and owner apply only to a file this resource creates; drop them, or set create: true',
      );
    }
  } else if (props.create === true) {
    found.push('create is for region mode only; a whole-file declaration always creates the file');
  }
  return found;
};

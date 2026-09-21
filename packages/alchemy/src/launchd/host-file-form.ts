/**
 * HostFile's props, attributes and validation — the pure half of the provider.
 *
 * ⛔ `content` IS NEVER A SECRET. Alchemy stores props unencrypted, so the content of every HostFile
 *   sits in the state store and in every plan diff. A secret file stays RENDERED BY A SECRET
 *   RENDERER (openbao-agent templates, on this estate) that fetches it at run time; the stack
 *   declares only non-secret config, and at most the PATH the renderer writes to.
 *   secret-tripwire.ts refuses the obvious case (a PEM private key); nothing can catch all of them.
 */
import { fileSecretProblems } from './secret-tripwire.ts';

export interface HostFileProps {
  /** Absolute path. The parent directory must already exist. */
  path: string;
  /** UTF-8 text. ⛔ Never a secret — see the file header. */
  content: string;
  /** Permission bits. @default 0o644 */
  mode?: number;
  /** User name or numeric uid. Omitted: whoever the runner writes as (a rewrite keeps no owner). */
  owner?: string | number;
  /** Group name or numeric gid. Omitted: the directory's default group. */
  group?: string | number;
}

export interface HostFileAttributes {
  path: string;
  /** SHA-256 of the bytes on disk. */
  sha256: string;
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

export const fileProblems = (props: HostFileProps): string[] => {
  const found: string[] = [];
  const { path } = props;
  if (!path.startsWith('/')) found.push('path must be absolute');
  // ★ One spelling per file: `a/./b`, `a//b` and `a/../b` would each be a second resource for the
  //   same inode, and `..` is how a derived path walks out of the directory it was meant for.
  if (
    path.endsWith('/') ||
    path
      .split('/')
      .slice(1)
      .some((part) => part === '' || part === '.' || part === '..')
  ) {
    found.push('path must be normalised (no trailing slash, no empty, "." or ".." segments)');
  }
  if (path.includes('\x00')) found.push('path contains NUL');
  const mode = props.mode ?? DEFAULT_MODE;
  if (!Number.isSafeInteger(mode) || mode < 0 || mode > 0o7777) found.push('mode must be 0–0o7777');
  found.push(...identityProblems('owner', props.owner));
  found.push(...identityProblems('group', props.group));
  found.push(...fileSecretProblems(props.content));
  return found;
};

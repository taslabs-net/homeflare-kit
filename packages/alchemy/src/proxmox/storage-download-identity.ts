/**
 * What makes a `Proxmox.StorageDownload` a DIFFERENT file, and what a changed pin on the SAME
 * file means. (2026-09-26, red-team I1/I2 on PR 297.)
 *
 * ★ `filename` (WITH `storage`) IS THE IDENTITY. PVE does not record what a volume was downloaded
 *   from — `GET .../content` reports only `format`/`size`/`volid` (storage-download-props.ts) — so
 *   once the file exists there is nothing left to compare a new `url`/`checksum` against except the
 *   PREVIOUS DECLARATION. `storage-download-lifecycle.ts`'s `diff` asks `judgeIdentity` before
 *   touching the file; a genuine identity change plans `replace` (delete the old file, download the
 *   new one under its own name) rather than the silent `update` that used to orphan the old file
 *   forever, and a changed pin on the SAME filename refuses rather than silently planning `noop`.
 */
import type { StorageDownloadProps } from './storage-download-props.ts';

/** The fields PVE never stores back, so a change in them is only visible against `olds`. */
const PINNED: readonly (keyof StorageDownloadProps)[] = [
  'checksum',
  'checksumAlgorithm',
  'compression',
  'url',
  'verifyCertificates',
];

export type IdentityVerdict =
  | { readonly kind: 'same' }
  | { readonly kind: 'replace' }
  | { readonly kind: 'pin-changed'; readonly refuse: string };

/**
 * `olds` is undefined for a resource with no prior declaration (a fresh create, or the recovery
 * read for an interrupted one) — neither case has a pin to compare, so both are `same`.
 */
export const judgeIdentity = (
  news: StorageDownloadProps,
  olds: StorageDownloadProps | undefined,
): IdentityVerdict => {
  if (olds === undefined) return { kind: 'same' };
  if (news.filename !== olds.filename || news.storage !== olds.storage) {
    return { kind: 'replace' };
  }
  const changed = PINNED.filter((key) => news[key] !== olds[key]);
  if (changed.length === 0) return { kind: 'same' };
  return {
    kind: 'pin-changed',
    refuse:
      `${news.filename}: ${changed.join(', ')} changed but filename did not. filename is the ` +
      'identity -- PVE does not record what a volume was downloaded from, so this declaration ' +
      'cannot be verified or rewritten in place. Change filename to force a new download.',
  };
};

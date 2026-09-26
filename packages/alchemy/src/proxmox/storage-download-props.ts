/** What a `Proxmox.StorageDownload` declaration says, and what its state keeps. See storage-download.ts's header. */
import type { WithTarget } from './resource.ts';

export type ChecksumAlgorithm = 'md5' | 'sha1' | 'sha224' | 'sha256' | 'sha384' | 'sha512';

export interface StorageDownloadProps extends WithTarget {
  /** The node this download runs on. Content lands on `storage`, shared or not — see the header. */
  node: string;
  storage: string;
  /** The name PVE gives the file under `storage`'s `import` content. Normalized by PVE on write. */
  filename: string;
  /** Where to fetch the image from. ⚠️ Not re-verified after create — PVE does not store it. */
  url: string;
  /** ⛔ Required. See storage-download.ts's header on why this resource narrows the vendor's own optional field. */
  checksum: string;
  checksumAlgorithm: ChecksumAlgorithm;
  /** Decompress the downloaded file with this algorithm before it lands on `storage`. */
  compression?: string;
  /** Verify the source's TLS certificate. PVE defaults this on; declare `false` for a self-signed mirror. */
  verifyCertificates?: boolean;
}

export interface StorageDownloadAttributes {
  node: string;
  storage: string;
  filename: string;
  /**
   * ⚠️ REASONED, NOT MEASURED LIVE. PVE's file-based content types spell a volid
   *   `<storage>:<segment>/<filename>` — this codebase already relies on that shape for `iso` and
   *   `vztmpl` (lxc-create-form.ts's `existingVolume`, lxc-create.test.ts's own fixture) — but the
   *   exact `<segment>` spelling for `import` content is not independently confirmed against a
   *   live cluster. `storage-download-lifecycle.ts`'s `readDownload` does not depend on knowing
   *   it: it matches by filename SUFFIX within a list already server-filtered to `content=import`.
   */
  volid: string;
  size: number;
  format: string;
}

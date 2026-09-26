/**
 * `Proxmox.StorageDownload` — one `download-url` fetch of an image onto a named storage's
 * `import` content, declared. Joined 2026-09-26 for Talos: a node needs a boot image on shared
 * storage (`cephtb4`/`cephfs-tb4`) before `Proxmox.Vm` can reference it as a disk source.
 *
 * ★ A CREATE-ORIENTED FAMILY, NOT A GENERAL DOWNLOADER. `content` is fixed to `import` — never a
 *   prop — because that is the one content type a VM disk import consumes; an ISO or a container
 *   template already has its own path (`upload`, or an out-of-band copy) and does not belong here.
 *
 * ⛔ `checksum` AND `checksumAlgorithm` ARE REQUIRED, NOT OPTIONAL, EVEN THOUGH PVE'S OWN SCHEMA
 *   MARKS BOTH OPTIONAL (`generated/pve/nodes-node-storage-storage.ts`). An unpinned download is
 *   not a declaration — it is a promise that whatever the URL answers today is what a Talos node
 *   boots from, silently, on every future adopt. This resource narrows the vendor's own contract
 *   on purpose; `storage-download-lifecycle.ts`'s `createRefusals` is the runtime backstop for a
 *   caller that casts around the type.
 *
 * ⛔ THERE IS NO UPDATE PATH. PVE does not remember the `url` or `checksum` a volume was created
 *   from — `GET .../content` reports only `format`/`size`/`volid` — so once the file exists on
 *   `storage`, this resource has nothing left to compare a new declaration against. A DIFFERENT
 *   `checksum` on an existing `filename` plans `noop`: change the filename to force a new
 *   download, exactly as an immutable artifact should be replaced.
 *
 * ⛔ NO SECRET IS A PROP. Every field here — `node`, `storage`, `filename`, `url`, the checksum
 *   pair, `compression`, `verifyCertificates` — is either an identity or a public download
 *   parameter; none is a credential, matching the "no secret prop" rule every PVE family here
 *   carries (see qemu-props.ts's `cipassword`/`machine` for the family that has one to guard).
 *
 * ★ NOT `retain` BY DEFAULT, UNLIKE `Proxmox.Vm`/`Proxmox.Lxc`. A downloaded image is reproducible
 *   from its own declaration (the same `url` and `checksum` rebuild it byte-for-byte); a VM's
 *   disk state or a container's data is not. Dropping this declaration deletes the file — an
 *   operator who wants to keep an unreferenced image around pins its own `RemovalPolicy.retain()`.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PveRequirements } from './resource.ts';
import { storageDownloadHandlers } from './storage-download-lifecycle.ts';
import type { StorageDownloadAttributes, StorageDownloadProps } from './storage-download-props.ts';

export type { StorageDownloadAttributes, StorageDownloadProps } from './storage-download-props.ts';

export interface ProxmoxStorageDownload extends Resource<
  'Proxmox.StorageDownload',
  StorageDownloadProps,
  StorageDownloadAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxStorageDownload = Resource<ProxmoxStorageDownload>('Proxmox.StorageDownload');

export const ProxmoxStorageDownloadProvider = () =>
  Provider.effect(
    ProxmoxStorageDownload,
    Effect.succeed(ProxmoxStorageDownload.Provider.of(storageDownloadHandlers)),
  );

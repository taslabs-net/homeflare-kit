/**
 * A pinned archive, verified, to the one member a declaration names, verified — the order the
 * checks run in is the point of the file.
 *
 *   1. the archive's SHA-256 against its pin — BEFORE a single byte is unpacked;
 *   2. gunzip and tar-read as one stream, keeping only the declared member (tar.ts refuses anything
 *      unsafe in the archive, asked-for or not);
 *   3. that member's SHA-256 against its own pin.
 *
 * ★ BOTH LAYERS, BECAUSE THE VENDOR HASHES BOTH. Each checksum file lists the archive AND every
 *   binary inside it (measured 2026-09-22, all four). The archive check says the download is the
 *   published file; the member check says the bytes about to be written are the published binary —
 *   and it is the only check that still holds if the tar reader were ever wrong about a boundary.
 * ★ DecompressionStream, THE WEB STANDARD: node and bun both ship it, so dist behaves the same
 *   under either runtime — no zlib binding, no dependency.
 * ⛔ IN MEMORY ONLY. Nothing here touches a disk, so no failure below can leave a staged download
 *   behind; the bytes reach a host only through HostRunner.writeFileAtomic (file-converge.ts).
 */
import { sha256Hex } from '../launchd/job-form.ts';
import type { PinnedDownload } from './binary-form.ts';
import { ArchiveRefused, ChecksumMismatch } from './refused.ts';
import { type TarContents, tarReader } from './tar.ts';

/** How much gzip is handed to the inflater at a time. */
const SLICE = 1 << 20;

/**
 * Gunzip and read a tar, keeping only `wanted`. Throws ArchiveRefused.
 * @param root The one declared leading directory to strip (tar.ts) — a directory-wrapped vendor
 *   archive (the Prometheus family, measured 2026-09-23) without it, or one that carries no root.
 */
export const extractMembers = async (
  gzipped: Uint8Array,
  wanted: ReadonlySet<string>,
  root?: string,
): Promise<TarContents> => {
  const tar = tarReader(wanted, root);
  // ⚠️ FED IN SLICES, ON DEMAND. Enqueued whole, the 123.6 MB vmutils archive is inflated in one
  //   transform step and all 264 MB of output queue up before the first read: MEASURED 2026-09-22,
  //   a peak RSS of 1116 MB for vmalert alone under bun 1.4.0. `pull` hands over the next slice only
  //   when the stream asks, so backpressure bounds what is inflated ahead of the tar reader.
  let offset = 0;
  // ★ The writable side of DecompressionStream accepts BufferSource (ArrayBuffer or a
  //   view). pipeThrough is invariant there, so a Uint8Array source is rejected even
  //   though every slice enqueued is one. Measured as TS2345 under TypeScript 7. No
  //   zlib package: Bun and Node both ship this stream.
  const source = new ReadableStream<ArrayBufferView | ArrayBuffer>({
    pull(controller) {
      if (offset >= gzipped.length) {
        controller.close();
        return;
      }
      controller.enqueue(gzipped.slice(offset, offset + SLICE));
      offset += SLICE;
    },
  });
  const unzipped = source.pipeThrough(new DecompressionStream('gzip')).getReader();
  try {
    for (;;) {
      const { done, value } = await unzipped.read();
      if (done) break;
      tar.push(value);
    }
  } catch (cause) {
    await unzipped.cancel().catch(() => undefined);
    if (cause instanceof ArchiveRefused) throw cause;
    throw new ArchiveRefused({ message: `not a gzip stream (${String(cause)})` });
  }
  return tar.finish();
};

const mismatch = (subject: string, expected: string, actual: string): ChecksumMismatch =>
  new ChecksumMismatch({
    actual,
    expected,
    message: `${subject} hashes to ${actual}, not the pinned ${expected}`,
    subject,
  });

/**
 * The declared member's bytes out of a downloaded archive, both layers checked.
 * ⚠️ `archive` may be shared with another resource's extraction (download.ts sharingInFlight):
 *   this only reads it.
 */
export const verifiedMember = async (
  archive: Uint8Array,
  release: PinnedDownload,
): Promise<Uint8Array> => {
  const archiveSha = sha256Hex(archive);
  if (archiveSha !== release.sha256) throw mismatch(release.url, release.sha256, archiveSha);
  const { members, names } = await extractMembers(archive, new Set([release.member]), release.root);
  const bytes = members.get(release.member);
  if (bytes === undefined) {
    const under = release.root === undefined ? '' : ` under root "${release.root}/"`;
    throw new ArchiveRefused({
      message: `${release.url} has no member named exactly "${release.member}"${under} (it has ${names.map((n) => `"${n}"`).join(', ') || 'none'})`,
    });
  }
  const memberSha = sha256Hex(bytes);
  if (memberSha !== release.memberSha256) {
    throw mismatch(`member "${release.member}"`, release.memberSha256, memberSha);
  }
  return bytes;
};

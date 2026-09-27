/**
 * StorageDownload lifecycle. Read finds a content row by filename; create downloads and polls;
 * delete is idempotent — a volume already gone is success, not a refusal.
 *
 * ⛔ 2026-09-26, red-team C2/I1/I2/I3 on PR 297: `read` and `reconcile` now go through
 *   `ownedRead`/`refuseTakeover` (C2) so a pre-existing file is never silently adopted — and then
 *   deleted, since this family is not retain-by-default; `diff` asks `storage-download-identity.ts`
 *   (I1/I2) before touching the file; the content list read uses the `read` role, not `provision`
 *   (I3, `credentials.ts`: "read for read/diff, provision for reconcile/delete").
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { refuseTakeover } from '../ownership/adopt.ts';
import { ownedRead } from '../ownership/probe.ts';
import { formViolations } from './constraint-guard.ts';
import { runPve } from './distilled-pve.ts';
import { judgeIdentity } from './storage-download-identity.ts';
import { StorageDownloadRefusedError } from './storage-download-errors.ts';
import type { StorageDownloadAttributes, StorageDownloadProps } from './storage-download-props.ts';
import { storageDownloadTask } from './storage-download-task.ts';
import { int, text } from './values.ts';

const CREATE_POLLS = 600; // an image download can run far longer than a config write
const DELETE_POLLS = 60;

/** ⚠️ Named as a literal so `codegen/constraints.ts`'s text scan tables it (that file's own header). */
const DOWNLOAD_ENDPOINT = 'pve:POST /nodes/{node}/storage/{storage}/download-url';

/**
 * The wire form, PVE-spelled (`checksum-algorithm`, `verify-certificates`) — what the generated
 * vendor table keys by, and what `formViolations` checks. ⚠️ NOT re-spelled for the SDK call:
 * `nodes.downloadNodesStorageUrl` never declares these two hyphenated names as typed properties
 * either (its schema names them `checksum_algorithm`/`verify_certificates`), so passing this
 * object straight through relies on protocol-http.ts's own documented "unknown keys pass through
 * as body fields" rule — the same spec-drift path qemu-props.ts leans on for `scsi0`/`net0`, and
 * unlike storage-wire.ts's `underscored()` this family has no reason to translate: the schema's
 * OWN property names would just be a second spelling of the same two fields.
 */
export const downloadForm = (props: StorageDownloadProps) => ({
  checksum: props.checksum,
  'checksum-algorithm': props.checksumAlgorithm,
  ...(props.compression === undefined ? {} : { compression: props.compression }),
  content: 'import',
  filename: props.filename,
  node: props.node,
  storage: props.storage,
  url: props.url,
  ...(props.verifyCertificates === undefined
    ? {}
    : { 'verify-certificates': props.verifyCertificates ? '1' : '0' }),
});

/**
 * Why this declaration cannot be sent, checked before every diff and every reconcile.
 * ⛔ `checksum` REQUIRED, EVEN THOUGH THE TYPE ALREADY SAYS SO — a JS caller or a cast can still
 *   leave it `''`; this is the runtime backstop storage-download.ts's header promises.
 */
export const createRefusals = (props: StorageDownloadProps): string[] => {
  const refuse: string[] = [];
  if (props.checksum.trim() === '') {
    refuse.push(
      `${props.filename}: checksum is required — an unpinned download is not a declaration.`,
    );
  }
  return refuse.concat(
    formViolations(DOWNLOAD_ENDPOINT, downloadForm(props), true).map(
      (why) => `${props.filename}: ${why}`,
    ),
  );
};

/**
 * `GET .../content?content=import`, matched by filename suffix — see storage-download-props.ts's
 * `volid` doc for why a suffix match, not an assumed prefix. `content` is already server-filtered.
 * ⛔ I3: THE `read` ROLE, NOT `provision` — this is a plain GET, and every caller (read/diff AND
 *   reconcile/delete, which mint their own `provision` credential for the actual write) may use the
 *   cheaper, longer-lived one, exactly as `qemu-read.ts`'s `readVm` already does for its own GET.
 */
export const readDownload = (props: StorageDownloadProps) =>
  Effect.gen(function* () {
    const rows = yield* runPve(
      props.target,
      'read',
      false,
      nodes.listNodeStorageContent({
        content: 'import',
        node: props.node,
        storage: props.storage,
      }),
    );
    if (!Array.isArray(rows)) {
      return yield* Effect.fail(
        new StorageDownloadRefusedError(
          `${props.storage}: the content list did not come back as a list.`,
        ),
      );
    }
    const found = rows.find((row) => row.volid.endsWith(`/${props.filename}`));
    if (found === undefined) return undefined;
    return {
      filename: props.filename,
      format: text(found.format, 'raw'),
      node: props.node,
      size: int(found.size, 0),
      storage: props.storage,
      volid: text(found.volid, ''),
    } satisfies StorageDownloadAttributes;
  });

/** ⛔ IDEMPOTENT DELETE (distilled doctrine): a volume already gone is success, never a refusal. */
export const destroyDownload = (props: StorageDownloadProps) =>
  Effect.gen(function* () {
    const live = yield* readDownload(props);
    if (live === undefined) return;
    yield* storageDownloadTask(
      props,
      nodes.deleteNodeStorageContent({
        node: props.node,
        storage: props.storage,
        volume: live.volid,
      }),
      `delete ${live.volid}`,
      DELETE_POLLS,
    );
  });

export const storageDownloadHandlers = {
  list: () => Effect.succeed([]),
  /**
   * ⛔ C2: `Unowned` unless state already vouches for it. With no attributes this is the adoption
   *   probe or the recovery read for an interrupted download; `filename` (with `storage`) is the
   *   whole identity this family has (storage-download-identity.ts), so once the row's own instance
   *   is proven to hold the WHOLE declaration (`ownership/rows.ts`, inside `ownedRead`), a matching
   *   file is ours -- there is no further per-key drift to prove, unlike a config-bearing resource.
   */
  read: Effect.fn(function* ({
    fqn,
    instanceId,
    olds,
    output,
  }: {
    fqn: string;
    instanceId: string;
    olds: StorageDownloadProps;
    output: StorageDownloadAttributes | undefined;
  }) {
    const found = yield* readDownload(olds);
    return yield* ownedRead({ fqn, instanceId, output }, found, Effect.succeed(true));
  }),
  diff: Effect.fn(function* ({
    news,
    olds,
    output,
  }: {
    news: Input<StorageDownloadProps>;
    olds: StorageDownloadProps;
    output: StorageDownloadAttributes | undefined;
  }) {
    if (!isResolved(news)) return undefined;
    const refused = createRefusals(news);
    if (refused.length > 0) {
      return yield* Effect.fail(new StorageDownloadRefusedError(refused.join('\n')));
    }
    if (output === undefined) return undefined;
    // ⛔ I1: a changed filename/storage is a DIFFERENT file -- plan a replace (delete the old one,
    //   download the new one under its own name) rather than the `update` that used to leave the
    //   old file orphaned forever with no state pointing at it.
    const identity = judgeIdentity(news, olds);
    if (identity.kind === 'replace') return { action: 'replace' } as const;
    const live = yield* readDownload(news);
    // ⛔ I2: a changed url/checksum/etc on the SAME filename is refused, never silently `noop` --
    //   PVE does not record what a volume was downloaded from, so this declaration cannot be
    //   verified or rewritten in place. Only when the file is actually there: if it already vanished
    //   out of band, the pin change is simply what the next download uses.
    if (identity.kind === 'pin-changed' && live !== undefined) {
      return yield* Effect.fail(new StorageDownloadRefusedError(identity.refuse));
    }
    return { action: live === undefined ? 'update' : 'noop' } as const;
  }),
  reconcile: Effect.fn(function* ({
    fqn,
    instanceId,
    news,
    output,
  }: {
    fqn: string;
    instanceId: string;
    news: StorageDownloadProps;
    output: StorageDownloadAttributes | undefined;
  }) {
    const refused = createRefusals(news);
    if (refused.length > 0) {
      return yield* Effect.fail(new StorageDownloadRefusedError(refused.join('\n')));
    }
    const live = yield* readDownload(news);
    if (live === undefined) {
      yield* storageDownloadTask(
        news,
        nodes.downloadNodesStorageUrl(downloadForm(news)),
        `download ${news.filename} onto ${news.storage}`,
        CREATE_POLLS,
      );
    } else {
      // ⛔ C2: a file already at this filename that this stack holds no state for is refused unless
      //   adoption is on. Without this, dropping the declaration later DELETES a file this stack
      //   never created — this family is not retain-by-default (storage-download.ts's header).
      yield* refuseTakeover(
        { fqn, instanceId, output },
        `Proxmox.StorageDownload ${news.filename} on ${news.storage}`,
      );
    }
    const after = yield* readDownload(news);
    if (after === undefined) {
      return yield* Effect.fail(
        new StorageDownloadRefusedError(
          `${news.filename}: the write returned no error but ${news.storage} still has no ` +
            'matching content — PVE may have normalised the filename; read it back by hand.',
        ),
      );
    }
    return after;
  }),
  delete: ({ olds }: { olds: StorageDownloadProps }) => destroyDownload(olds),
};

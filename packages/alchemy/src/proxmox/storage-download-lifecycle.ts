/**
 * StorageDownload lifecycle. Read finds a content row by filename; create downloads and polls;
 * delete is idempotent — a volume already gone is success, not a refusal.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as nodes from '@distilled.cloud/proxmox/nodes';
import * as Effect from 'effect/Effect';
import { formViolations } from './constraint-guard.ts';
import { runPve } from './distilled-pve.ts';
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
 */
export const readDownload = (props: StorageDownloadProps) =>
  Effect.gen(function* () {
    const rows = yield* runPve(
      props.target,
      'provision',
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
  read: ({ olds }: { olds: StorageDownloadProps }) => readDownload(olds),
  diff: Effect.fn(function* ({
    news,
    output,
  }: {
    news: Input<StorageDownloadProps>;
    output: StorageDownloadAttributes | undefined;
  }) {
    if (!isResolved(news)) return undefined;
    const refused = createRefusals(news);
    if (refused.length > 0) {
      return yield* Effect.fail(new StorageDownloadRefusedError(refused.join('\n')));
    }
    if (output === undefined) return undefined;
    const live = yield* readDownload(news);
    // ⛔ NEVER 'replace': a changed url/checksum on an existing filename is unobservable (the
    //   header explains why) and a differing DECLARATION is not evidence the live file differs.
    return { action: live === undefined ? 'update' : 'noop' } as const;
  }),
  reconcile: Effect.fn(function* ({ news }: { news: StorageDownloadProps }) {
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

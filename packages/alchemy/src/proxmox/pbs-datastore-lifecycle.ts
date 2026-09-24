/** PBS 4.2.6-1 datastore lifecycle. Reads and writes use the distilled SDK. */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type { PbsDatastoreProps } from './pbs-datastore.ts';
import { type PbsDatastoreAttributes, matches, object, updateForm } from './pbs-datastore-form.ts';
import { createOne, deleteOne, readOne, updateOne } from './pbs-datastore-wire.ts';
import { guardBackend, guardPath, settle } from './pbs-datastore-guard.ts';
import { guardDatastoreForms } from './pbs-datastore-endpoint.ts';
import { formToSend } from './update-guard.ts';

export const handlers = {
  /**
   * ⛔ EMPTY, AND HERE IT GUARDS THE ESTATE'S BACKUPS. `GET /config/datastore` returns every
   *   datastore on the host, the one PVE's `type: pbs` storage writes into included. See
   *   `pveHandlers` in resource.ts for why adoption stays an explicit act.
   */
  list: () => Effect.succeed([]),
  read: ({ olds }: { olds: PbsDatastoreProps }) => readOne(olds),
  /**
   * ⚠️ `isResolved` IS THE NARROWING, resource.ts's reason: at plan time a prop can still be an
   *   unresolved Output, and comparing a placeholder to a live value reports a phantom update.
   * ⛔ `guardPath` IS A DELIBERATE DEPARTURE FROM storage.ts, which lets its create-only field
   *   plan as noop. Dying fails `alchemy plan` with both paths named — see the ⛔ on the prop.
   */
  diff: ({
    news,
    output,
  }: {
    news: Input<PbsDatastoreProps>;
    output: PbsDatastoreAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      // ⛔ BEFORE the `output === undefined` return: that branch IS the create, which is the
      //   one this family has never checked. resource.ts carries the argument in full.
      yield* guardDatastoreForms(news);
      if (output === undefined) return undefined;
      const live = yield* readOne(news);
      // ⚠️ `update`, not `create` — Alchemy's Diff admits only noop/update/replace, and an
      //   object Alchemy has state for but PBS does not is drift for reconcile to repair.
      if (live === undefined) return { action: 'update' } as const;
      yield* guardPath(live, news);
      yield* guardBackend(live, news);
      return matches(live, news) ? ({ action: 'noop' } as const) : ({ action: 'update' } as const);
    }),
  /**
   * ⚠️ NOT THE FACTORY'S reconcile: it reads back ONCE, immediately — see the ⛔ on `settle`.
   * ⛔ `guardPath` RUNS HERE TOO, AND THAT IS NOT BELT-AND-BRACES — see the ⛔ on it.
   * ⛔ THE `matches` GUARD BEFORE THE PUT IS resource.ts's, AND IT IS WHY ADOPTION IS FREE.
   */
  reconcile: Effect.fn(function* ({ news }: { news: PbsDatastoreProps }) {
    // ⚠️ Again here: an ADOPTED row's diff answer is discarded by Alchemy and reconcile runs.
    yield* guardDatastoreForms(news);
    const live = yield* readOne(news);
    if (live === undefined) {
      yield* createOne(news);
    } else {
      yield* guardPath(live, news);
      yield* guardBackend(live, news);
      // ⚠️ An empty form is not a write, and a match is not one either — update-guard.ts.
      const form = formToSend(matches, live, news, updateForm(news));
      if (form !== undefined) {
        yield* updateOne(news);
      }
    }
    const after = yield* settle(readOne(news), (row) => row !== undefined && matches(row, news));
    if (after === undefined || !matches(after, news)) {
      /**
       * ⛔ REFUSE RATHER THAN RETURN THE PROPS AS THOUGH THEY LANDED — resource.ts's rule.
       *   The pinned PBS 4.2.6-1 schema gives create a null return, so readback is its evidence.
       */
      return yield* Effect.die(
        new Error(
          `${object(news)}: the write returned no error but the datastore still does not ` +
            'match the declaration after 120s. Check the PBS task list ' +
            '-- read it with `proxmox-backup-manager task log <upid>`. A slow disk is a ' +
            'plausible cause (see `settle`); a create over an existing chunk store is not, ' +
            'because PBS refuses that outright rather than timing out.',
        ),
      );
    }
    return after;
  }),
  /**
   * ⛔ FULLY IMPLEMENTED, NEVER A STUB, and it only ever runs on an explicit
   *   `.pipe(RemovalPolicy.destroy())` because this family defaults to `retain`.
   * ⛔ NO `destroy-data`. PBS's DELETE drops the section from `datastore.cfg` and leaves every
   *   chunk and snapshot on disk; `destroy-data=1` erases the contents. It is not a prop and
   *   not a flag here, so this provider can un-declare a datastore and can never erase one.
   *   ⚠️ IT IS STILL A ONE-WAY DOOR FOR A DECLARATION: re-adding a datastore over an existing
   *     chunk store needs `reuse-datastore`, which is deliberately not declarable — see the
   *     ⚠️ on `createForm`. Re-adopt with `proxmox-backup-manager datastore create …`.
   * ⚠️ NO `keep-job-configs` EITHER, SO THE JOBS GO TOO: PBS defaults it false and removes the
   *   verify, sync and prune jobs referencing this datastore — objects nothing here declares.
   *   PBS's default stands, so the blast radius is what a human clicking Remove would get.
   * ⚠️ AND THE REFUSAL CAN ARRIVE AFTER THE RESPONSE: the delete forks a worker too, so a store
   *   held open by a running backup can fail once the call has already returned 200.
   */
  delete: Effect.fn(function* ({ olds }: { olds: PbsDatastoreProps }) {
    yield* deleteOne(olds);
    const left = yield* settle(readOne(olds), (row) => row === undefined);
    if (left !== undefined) {
      return yield* Effect.die(
        new Error(
          `${object(olds)}: the DELETE returned no error but the datastore is still in ` +
            'datastore.cfg after 120s. Either a backup, verify or GC task still holds it, ' +
            'or the provision role lacks Datastore.Allocate on /datastore/' +
            `${olds.name}. Read the task log with \`proxmox-backup-manager task log <upid>\`.`,
        ),
      );
    }
  }),
};

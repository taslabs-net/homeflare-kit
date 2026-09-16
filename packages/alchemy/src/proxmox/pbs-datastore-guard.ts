/**
 * The two things a datastore write needs that are not form-building: refusing a moved `path`, and
 * waiting for PBS to finish.
 *
 * ★ SPLIT OUT OF pbs-datastore-form.ts FOR THE 250-LINE CAP, and the seam is real. That file turns
 *   a declaration into a form; this one is the SAFETY GUARD and the POLLING. A reader asking "can
 *   this destroy my backups" has one short file to read rather than a long one to search.
 */
import * as Effect from 'effect/Effect';
import { type PbsDatastoreAttributes, object } from './pbs-datastore-form.ts';
import type { PbsDatastoreProps } from './pbs-datastore.ts';
import { propertyString } from './values.ts';

/**
 * ⛔ A TRAILING SLASH MUST NOT DEADLOCK EVERY PLAN, WHICH IS WHY THIS IS NOT `===`. `guardPath`
 *   DIES, so a false positive is not a spurious update — it is an `alchemy plan` that cannot run at
 *   all until somebody edits the declaration, on a family whose whole point is that the operator
 *   can see the state of their backups. `/mnt/backups/` and `/mnt/backups` are one directory, and
 *   whether PBS canonicalises the path it was handed is a property of the version you are talking
 *   to. Both sides are trimmed here so that guess cannot cost an outage of the plan itself.
 * ⚠️ THAT IS THE ONLY NORMALISATION APPLIED. A symlink, a bind mount or `/mnt/./backups` still
 *   reads as divergent, and deliberately so: this guard's job is to refuse to GUESS that two
 *   spellings are the same directory, and only the trailing slash is certain.
 */
const samePath = (left: string, right: string) => {
  const trim = (value: string) => (value.length > 1 ? value.replace(/\/+$/, '') : value);
  return trim(left) === trim(right);
};

/**
 * ⛔ THE `path` GUARD, YIELDED FROM BOTH `diff` AND `reconcile`. Both need it: `diff` catches a
 *   changed declaration, and `reconcile` catches an ADOPTION, which Alchemy routes straight past
 *   `diff` (Apply.ts:980, :1045). `''` is skipped — an unreadable path is not a divergent one.
 */
export const guardPath = (live: PbsDatastoreAttributes, props: PbsDatastoreProps) =>
  live.path === '' || samePath(live.path, props.path)
    ? Effect.void
    : Effect.die(
        new Error(
          `${object(props)}: declared path ${props.path} but PBS holds ${live.path}. \`path\` ` +
            'is create-only, so this cannot be reconciled and will NOT be planned as a silent ' +
            'noop: backups would keep landing in the old directory behind a green plan. Correct ' +
            'the declaration, or remove the datastore and declare a new one -- the contents live, ' +
            'because `destroy-data` is never sent.',
        ),
      );

/**
 * ⛔ THE `backend` GUARD, AND IT MATTERS MORE THAN `path`. A wrong `path` sends backups to the
 *   wrong directory on the same machine; a wrong `backend` is the difference between a datastore
 *   on local disk and one in a Cloudflare R2 bucket. MEASURED on 4.2: `datastore create` takes
 *   `--backend`, `datastore update` does not, and `backend` is not in update's `--delete` enum —
 *   so divergence CANNOT be reconciled, and the only honest options are to refuse or to lie.
 *
 * ⚠️ AN UNDECLARED `backend` IS NOT A DIVERGENCE. Undeclared is unmanaged everywhere in this
 *   family, and this guard keeps that rule: it fires only when the declaration says something and
 *   PBS says something else. Adopting `r2-offsite` without mentioning `backend` still plans noop.
 *
 * ⚠️ COMPARED AS A CANONICAL PROPERTY STRING, so `bucket=x,type=s3` and `type=s3,bucket=x` are the
 *   same backend and key order cannot deadlock a plan — the reason `samePath` trims a slash.
 */
export const guardBackend = (live: PbsDatastoreAttributes, props: PbsDatastoreProps) =>
  props.backend === undefined || propertyString(props.backend) === live.backend
    ? Effect.void
    : Effect.die(
        new Error(
          `${object(props)}: declared backend ${props.backend} but PBS holds ` +
            `${live.backend === '' ? '(none — a local datastore)' : live.backend}. \`backend\` ` +
            'is create-only: PBS has no update for it, so this cannot be reconciled and will NOT ' +
            'be planned as a silent noop. Correct the declaration to match what is really there, ' +
            'or remove the datastore and declare a new one -- the contents live, because ' +
            '`destroy-data` is never sent.',
        ),
      );

/**
 * Wait for PBS to finish, then answer the last thing it said.
 *
 * ⛔ IT EXISTS BECAUSE A PBS CREATE IS A FORKED WORKER AND THE CONFIG SECTION IS WRITTEN LAST.
 *   `POST /config/datastore` answers with a UPID while a `create-datastore` task builds the chunk
 *   store's 65536 directories; only when that finishes does the section reach `datastore.cfg`. An
 *   immediate read-back therefore sees a datastore that is not there yet, and the factory's "the
 *   write returned no error but the object is still absent" would fire on a create going perfectly.
 *   The DELETE forks a worker too. ⚠️ DOCUMENTED FROM THE PUBLISHED SCHEMA, NOT MEASURED — I hold
 *   no PBS token. If a create turns out to be synchronous, the first poll simply succeeds.
 * ★ IT TAKES THE READ AS AN EFFECT RATHER THAN A FUNCTION — the one simplification over
 *   ceph-pool-settle.ts: an Effect is a description, so re-running it re-reads and no dependency
 *   has to be threaded back in to avoid a cycle.
 * ⚠️ 2s APART, 60 TRIES, ABOUT TWO MINUTES — longer than ceph-pool's minute, and REASONED rather
 *   than measured: 65536 `mkdir`s is seconds on NVMe and can be a minute on a slow or USB disk.
 *   Anything still unsettled after two minutes is a fault to surface, not a wait to lengthen, and
 *   the caller's message points at the task log, which is where the real answer is. `Effect.sleep`
 *   yields between polls; nothing here parks a call on one long wait.
 * ⚠️ POLLING THE TASK STATUS INSTEAD WOULD BE WORSE, for ceph-pool-settle.ts's reason: every call
 *   mints a FRESH token, so the token asking about the task is not the one that started it.
 */
export const settle = <A, E, R>(read: Effect.Effect<A, E, R>, done: (live: A) => boolean) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const live = yield* read;
      if (done(live)) return live;
      yield* Effect.sleep('2 seconds');
    }
    return yield* read;
  });

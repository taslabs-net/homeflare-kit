/**
 * `Proxmox.CephFlag`'s distilled wire lane: the read and the single-flag write.
 *
 * ★ SPLIT OUT OF ceph-flag.ts FOR THE 250-LINE CAP, mirroring ceph-pool-wire.ts's split by "touches
 *   the cluster or not" — ceph-flag.ts keeps the header, the props/attributes shapes, `matches` and
 *   the provider wiring; this file is the only place that calls `runPve` for this family.
 *
 * ⛔ NEITHER OPERATION HERE DECLARES A TYPED ABSENCE (`errors: []` on both `getClusterCephFlag` and
 *   `putClusterCephFlag`, MEASURED in distilled-proxmox/src/services/cluster.ts) — UNLIKE
 *   ceph-pool-wire.ts's `CephPoolNotFound`. All eleven flags always exist (ceph-flag.ts's own ⛔ on
 *   `CephFlagName` and on the old unreachable create branch), so there is no absence case to fold
 *   here. `readClusterCephFlag` therefore has no `catchTag` at all and lets every failure — a
 *   refused credential, a timeout, cluster exhaustion — propagate to the caller exactly as it
 *   arrived, rather than inventing an "absent" this family does not have. Simpler than
 *   ceph-pool-wire.ts's case, not harder.
 *   ⚠️ THIS IS A BEHAVIOR CHANGE FROM THE PRE-MIGRATION FACTORY, AND A DELIBERATE ONE. The old
 *     `pveOperations.read` folded EVERY failure into `undefined` via `Effect.orElseSucceed`, so an
 *     expired lease or node-b being down looked identical to "the flag is absent" (which cannot
 *     happen — see ceph-flag.ts). Now such a failure propagates as itself: a caller sees the real
 *     error (an expired 300s lease, node-b down, ceph not configured) rather than a misleading
 *     "absent" that would have sent `diff`/`reconcile` down a create path this endpoint has never
 *     implemented. Same advice as the old comment gave, sharper because the failure is no longer
 *     disguised.
 *
 * ⛔ THE PER-FLAG PUT IS SYNCHRONOUS (`$rados->mon_command` inline, MEASURED in Ceph.pm — see
 *   ceph-flag.ts's header), which is what makes reading back immediately after
 *   `writeClusterCephFlag` fair rather than a race against a worker task, unlike ceph-pool.ts's
 *   forked-worker writes.
 */
import * as cluster from '@distilled.cloud/proxmox/cluster';
import * as Effect from 'effect/Effect';
import type { CephFlagAttributes, CephFlagProps } from './ceph-flag.ts';
import { runPve } from './distilled-pve.ts';
import { bool, flag } from './values.ts';

/** The one endpoint this family writes, as `guardWrite` (distilled-guard.ts) keys it. */
export const CEPH_FLAG_UPDATE = 'pve:PUT /cluster/ceph/flags/{flag}';

/**
 * ⚠️ `live` IS A BARE BOOLEAN HERE, NOT AN OBJECT, AND IT IS HANDED TO `bool` WHOLE ON PURPOSE.
 *   `get_flag` returns perl `1` or `0` under a `type => 'boolean'` return schema, so the wire is
 *   `{"data":0}` or `{"data":false}` depending on how the REST layer renders it — matching
 *   distilled's `GetClusterCephFlagResponse = unknown` (`S.Unknown.pipe(T.RawResponseRoot())`).
 *   `bool` accepts every one of those spellings, which is exactly why it is a shared coercion.
 *   ⚠️ THE SCALAR IS A MEASURED PROPERTY OF THIS PVE, NOT A PROMISE. A later version wrapping the
 *     answer in an object would make `bool` read a SET flag as false, and `value: false` would then
 *     plan `noop` over a live flag — silently. Re-measure `GET /cluster/ceph/flags/noout` after a
 *     major upgrade; cheaper than a second parse path.
 */
const attributesOf = (live: unknown, props: CephFlagProps): CephFlagAttributes => ({
  flag: props.flag,
  value: bool(live),
});

/**
 * ⛔ `Effect.die`, NOT a silent coercion, on `null`/`undefined`. `bool` treats a missing value as
 *   `false` because most callers hand it an optional PVE form field where that is correct — but
 *   here it would read an unmeasured "no answer" as "flag is clear", and distilled's
 *   `transformResponse` maps a `{"data":null}` body to `{}` before this ever sees it (a shape
 *   `get_flag`'s `type => 'boolean'` schema does not document and this PVE has never produced).
 *   `value: false` in state would then plan `noop` over that silence with no read-back guard to
 *   catch it (`reconcile`'s guard only fires on a write). Dying surfaces the unmeasured shape
 *   instead of guessing a brake's position.
 */
const definedOrDie = (live: unknown, props: CephFlagProps) =>
  live === null || live === undefined
    ? Effect.die(
        new Error(
          `cluster/ceph/flags/${props.flag}: GET answered with no data (null/undefined). This ` +
            "endpoint's success is documented as a bare boolean, not an absence -- check " +
            '`ceph osd dump | head -1` and the cluster log rather than trust a coerced `false`.',
        ),
      )
    : Effect.succeed(live);

/** The live flag, as attributes. No `catchTag`: see the file header. */
export const readClusterCephFlag = (props: CephFlagProps) =>
  runPve(props.target, 'read', false, cluster.getClusterCephFlag({ flag: props.flag })).pipe(
    Effect.flatMap((live) => definedOrDie(live, props)),
    Effect.map((live) => attributesOf(live, props)),
  );

/**
 * ⚠️ ONLY `value` GOES IN THE BODY. `flag` is already bound by the path and the PUT declares
 *   `additionalProperties => 0`, so a second copy in the form could only disagree with the URL.
 * ⚠️ THE `?? '0'` IS UNREACHABLE, AND IS WRITTEN RATHER THAN CAST AWAY. `flag()` types its answer
 *   `string | undefined` because it serves OPTIONAL props, and `value` here is required, so the
 *   branch cannot be taken; a cast would claim a proof the type system has not made.
 */
export const updateForm = (props: CephFlagProps) => ({ value: flag(props.value) ?? '0' });

/** The actual `putClusterCephFlag` call — `updateForm`'s own `value`, so the two cannot disagree. */
export const writeClusterCephFlag = (props: CephFlagProps) =>
  runPve(
    props.target,
    'provision',
    true,
    cluster.putClusterCephFlag({ flag: props.flag, value: updateForm(props).value }),
  );

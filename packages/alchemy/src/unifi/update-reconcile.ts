/**
 * The three-way `reconcile` every updatable `Unifi.*` family shares (today: `Unifi.Network`).
 *
 * ⛔ THREE INPUTS, NOT TWO. `news` is the declaration now, `olds` is the declaration the LAST
 *   DEPLOY wrote (Alchemy state), `live` is the raw object read right now. The PUT body is built
 *   from `live` plus ONLY the fields where `news` differs from `olds` (`computePatch`) — never
 *   from `news` alone. So (HIGH-2) a hand edit on a field the declaration never touched is carried
 *   through unchanged instead of reverted, and a hand edit on ANY declared field is refused
 *   outright (step 4) rather than overwritten.
 *
 * ★ `unset` IS WHAT MAKES A REVERT REAL (HIGH-1). Deleting an override from a declaration makes
 *   `news[k]` absent while `olds[k]` is set; a patch that only carried `set` would see "nothing
 *   changed" and the revert would never write. A key present in `olds` and null/absent in `news`
 *   lands in `unset`, and the family's `write` removes it from the body.
 *
 * ⛔ FIRST DEPLOY IS ADOPT-ONLY BY CONSTRUCTION (F1, LOW-8). Without BOTH `olds` and `output` there
 *   is no last-deployed baseline to patch against, so the write refuses. That also covers beta.81's
 *   forced post-adoption reconcile (H6): on a match (step 2) it returns live with zero writes.
 *   `olds` must also name the SAME object as `news` (`UnifiIdentityChanged`).
 *
 * ⛔ SCOPE (`update.checkScope`) runs before the note and any request: the family decides what a
 *   patch may touch (`network-scope.ts`). An omitted optional block is turned OFF by a whole-object
 *   PUT, so removing a key is allowed only for an explicit allowlist.
 *
 * ⚠️ NOTES AND ERRORS CARRY FIELD NAMES ONLY, NEVER VALUES.
 */
import { deepEqual } from 'alchemy/Diff';
import type { UnifiNetworkOpContext } from '@distilled.cloud/unifi-network/Protocol';
import * as Effect from 'effect/Effect';
import type { FieldDrift } from './drift.ts';
import {
  UnifiIdentityChanged,
  UnifiLiveDriftedSinceDeploy,
  UnifiUpdateDidNotConverge,
  refuseWrite,
} from './policy.ts';
import type { UnifiSpec } from './resource.ts';
import type { AllowedWrite } from './wire-guard.ts';

export type Patch<Props> = { set: Partial<Props>; unset: ReadonlyArray<keyof Props> };

/** The write half of a spec: everything needed to PUT one object, and nothing to create/delete. */
export type UnifiUpdate<Props extends object, Live, E2> = {
  /** The one PUT the wire guard may pass for this row (path pinned to the row's own ids). */
  readonly allowedWrite: (props: Props) => AllowedWrite;
  /** Declarable keys; never the identity keys. */
  readonly patchKeys: ReadonlyArray<keyof Props>;
  readonly driftOf: (live: Live, props: Props) => ReadonlyArray<FieldDrift>;
  /** Refuses (typed, before any note or request) a patch outside this family's write scope. */
  readonly checkScope: (live: Live, patch: Patch<Props>, props: Props) => Effect.Effect<void, E2>;
  readonly write: (
    live: Live,
    patch: Patch<Props>,
    props: Props,
  ) => Effect.Effect<Live, E2, UnifiNetworkOpContext>;
};

/** Keys whose `news` value differs from `olds`: set when still declared, unset when dropped. */
export const computePatch = <Props extends object>(
  news: Props,
  olds: Props,
  patchKeys: ReadonlyArray<keyof Props>,
): Patch<Props> => {
  const set: Partial<Props> = {};
  const unset: Array<keyof Props> = [];
  for (const key of patchKeys) {
    if (deepEqual(news[key], olds[key], { stripNullish: true })) continue;
    if (news[key] == null) unset.push(key);
    else set[key] = news[key];
  }
  return { set, unset };
};

export type ReconcileArgs<Props extends object> = {
  readonly news: Props;
  readonly olds: Props | undefined;
  readonly output: unknown;
  readonly note: (message: string) => Effect.Effect<void>;
};

export const updateReconcile = <Props extends object, Live, Attributes extends object, E, E2>(
  spec: UnifiSpec<Props, Live, Attributes, E, E2>,
  { news, olds, output, note }: ReconcileArgs<Props>,
) =>
  Effect.gen(function* () {
    const identity = spec.describe(news);
    const live = yield* spec.fetchLive(news);
    if (live === undefined) return yield* refuseWrite(spec.type, identity, 'create');
    const attrs = spec.attributes(live, news);
    // Exact match: zero writes, correct for a routine deploy and the forced post-adoption call.
    if (spec.matches(attrs, news)) return attrs;
    const update = spec.update;
    if (update === undefined || olds === undefined || output === undefined) {
      return yield* refuseWrite(spec.type, identity, 'update');
    }
    // ⛔ `olds` is the baseline for THIS object only; another site or network id is no baseline.
    const previous = spec.describe(olds);
    if (previous !== identity) {
      return yield* new UnifiIdentityChanged({ type: spec.type, identity, previous });
    }
    const drifted = update.driftOf(live, olds).map((d) => d.field);
    if (drifted.length > 0) {
      return yield* new UnifiLiveDriftedSinceDeploy({
        type: spec.type,
        identity,
        fields: drifted,
      });
    }
    const patch = computePatch(news, olds, update.patchKeys);
    if (Object.keys(patch.set).length === 0 && patch.unset.length === 0) {
      return yield* refuseWrite(spec.type, identity, 'update');
    }
    yield* update.checkScope(live, patch, news);
    yield* note(
      `${spec.type} ${identity}: PUT changes [${Object.keys(patch.set).join(', ')}] ` +
        `removes [${patch.unset.map(String).join(', ')}]`,
    );
    const written = yield* update.write(live, patch, news);
    const writtenAttrs = spec.attributes(written, news);
    if (spec.matches(writtenAttrs, news)) return writtenAttrs;
    return yield* new UnifiUpdateDidNotConverge({
      type: spec.type,
      identity,
      fields: update.driftOf(written, news).map((d) => d.field),
    });
  });

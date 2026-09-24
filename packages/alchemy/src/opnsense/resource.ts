/**
 * One shape for every OPNsense object this family declares — `read`/`diff` mirroring
 * `../discord/resource.ts`'s marker-less-API posture exactly (S7–S9, H1), and `reconcile`/
 * `delete` replaced end to end with the read-only refusal `policy.ts` states.
 *
 * ★ WHY ONE ENGINE FOR THREE RESOURCES. `alias.ts`, `category.ts` and `group.ts` differ only in
 *   which `firewall_*` module they call and how a live item maps to attributes — the read/diff/
 *   reconcile/delete flow is identical, so it lives here once, the way `netbox/resource.ts` and
 *   `discord/resource.ts` already do for their own families.
 *
 * ★ `Unowned(attrs)` ON A COLD READ, PLAIN ATTRIBUTES ON A WARM ONE (S7, S8). None of Alias,
 *   Category or Group carries an ownership marker OPNsense itself understands — no tag, no
 *   metadata field a stack could stamp — so this is the same "marker-less API" S8 describes, and
 *   the same posture `../discord/resource.ts` documents against `Snippet.ts`'s reference read.
 *   `adopt(true)` (H5), piped on by each resource file's convenience constructor, is what turns
 *   an `Unowned` first read into a silent one-time takeover instead of an `OwnedBySomeoneElse`
 *   refusal — exactly what an import script generating `alchemy.run.ts` rows from live reads
 *   needs: declare what is live, adopt it, change nothing.
 *
 * ⛔ `reconcile` AND `delete` NEVER CALL AN SDK OPERATION. `reconcile` still OBSERVES first (one
 *   GET, via `read`) so the refusal it raises can say whether it would have created or updated —
 *   S9's "observe before you write" doctrine, kept for the error message even though there is no
 *   write to guard. `delete` observes nothing: it refuses unconditionally, because under this
 *   policy a delete never succeeds regardless of whether the object is still live. See policy.ts.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import type { OpnsenseOpContext } from '@distilled.cloud/opnsense/Protocol';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import { CredentialsFromEnv } from './credentials.ts';
import { refuseWrite } from './policy.ts';

/** What every stack must still provide after `opnsenseHandlers` bakes in `CredentialsFromEnv`. */
export type OpnsenseRequirements = HttpClient.HttpClient;

/** Every resource in this family identifies its live object by OPNsense's own assigned uuid. */
export interface OpnsenseIdentity {
  readonly uuid: string;
}

/**
 * One OPNsense object's read path. `Live` is whatever the generated `get()` response decodes to
 * for one item (an `AliasItem`, `CategoryItem`, `GroupItem`); `E` is left to each resource file
 * to declare — in practice always `OpnsenseOpError`, since every generated operation shares one
 * error channel (protocol.ts).
 */
export type OpnsenseSpec<Props extends OpnsenseIdentity, Live, Attributes extends object, E> = {
  readonly resourceType: string;
  /** Absent when `props.uuid` is not a key in the live model's map — see each resource file. */
  readonly fetchLive: (props: Props) => Effect.Effect<Live | undefined, E, OpnsenseOpContext>;
  /** Also the declaration renderer (S.T. propsFromLive re-export) — see each `*-form.ts`. */
  readonly attributes: (uuid: string, live: Live) => Attributes;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
};

export const opnsenseOperations = <
  Props extends OpnsenseIdentity,
  Live,
  Attributes extends object,
  E,
>(
  spec: OpnsenseSpec<Props, Live, Attributes, E>,
) => {
  const read = (props: Props) =>
    spec
      .fetchLive(props)
      .pipe(
        Effect.map((live) => (live === undefined ? undefined : spec.attributes(props.uuid, live))),
      );

  return {
    read: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
      Effect.gen(function* () {
        const attrs = yield* read(olds);
        if (attrs === undefined) return undefined;
        // Warm read: a prior apply already adopted this exact uuid — ours.
        if (output !== undefined) return attrs;
        // Cold read (fresh store, or state lost): no ownership marker exists on this vendor.
        return Unowned(attrs);
      }),

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* read(news);
        if (live === undefined) return { action: 'update' } as const;
        return spec.matches(live, news)
          ? ({ action: 'noop' } as const)
          : ({ action: 'update' } as const);
      }),

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const live = yield* read(news);
        return yield* refuseWrite(
          spec.resourceType,
          news.uuid,
          live === undefined ? 'create' : 'update',
        );
      }),

    destroy: (olds: Props) => refuseWrite(spec.resourceType, olds.uuid, 'delete'),
  };
};

/**
 * The provider handlers for a spec'd OPNsense object, wired once. `list` answers empty — every
 * `get()` in this family returns the WHOLE model tree with no per-account/per-scope narrowing,
 * so a `list` that enumerated it would sweep the estate's entire alias/category/group set into
 * one plan; adoption stays explicit, one uuid at a time, the same reasoning netbox's and
 * discord's own `list` give for a shared or marker-less object space (S12).
 *
 * `nuke: { skip: true }` — `delete` refuses unconditionally (policy.ts), so `alchemy unsafe
 * nuke` could never do anything here but fail loudly on every object it found; skipping keeps
 * that refusal out of a nuke census entirely, matching `postgres/database.ts` and
 * `github/repository-ruleset.ts`'s own `nuke: { skip: true }` for the same reason.
 */
export const opnsenseHandlers = <
  Props extends OpnsenseIdentity,
  Live,
  Attributes extends object,
  E,
>(
  spec: OpnsenseSpec<Props, Live, Attributes, E>,
) => {
  const ops = opnsenseOperations(spec);
  // ⚠️ GENERIC OVER ITS OWN ERROR AND REQUIREMENT CHANNELS, NOT PINNED TO `E`/`OpnsenseOpContext`.
  //   `read`/`diff` fail with `E` and need `OpnsenseOpContext`; `reconcile` fails with
  //   `E | OpnsenseWriteRefused` (it observes, then refuses) and still needs `OpnsenseOpContext`
  //   for that observe; `delete` fails with `OpnsenseWriteRefused` alone and needs NOTHING (it
  //   never observes) — three different signatures sharing one credentials-providing wrapper.
  const withCredentials = <A, Err, R>(effect: Effect.Effect<A, Err, R>) =>
    Effect.provide(effect, CredentialsFromEnv);
  return {
    list: () => Effect.succeed([]),
    nuke: { skip: true },
    read: ({ olds, output }: { olds: Props; output: Attributes | undefined }) =>
      withCredentials(ops.read({ olds, output })),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      withCredentials(ops.diff(news, output)),
    reconcile: ({ news }: { news: Props }) => withCredentials(ops.reconcile(news)),
    delete: ({ olds }: { olds: Props }) => withCredentials(ops.destroy(olds)),
  };
};

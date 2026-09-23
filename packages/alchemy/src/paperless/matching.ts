/**
 * One shape for every Paperless taxonomy object (Tag, DocumentType, StoragePath, CustomField):
 * locate by `name__iexact` only while there is no prior state, identify the exact (name, owner),
 * create-or-update, never delete by default. Modelled on `../netbox/resource.ts`'s
 * `netboxOperations`, with the differences this unit's spec calls for.
 *
 * ⛔ THE CREATE BODY ALWAYS CARRIES `owner`, NULL WHEN UNDECLARED. `OwnedObjectSerializer.create`
 *   sets the owner to the TOKEN USER when the field is absent from the body (Paperless-ngx
 *   `documents/serialisers.py:495-502` at v3.1.1) — omitting it the way NetBox's `prefix-form.ts`
 *   omits an undeclared foreign key would silently create an object owned by whichever credential
 *   ran the deploy, invisible to every other user and a second row beside the estate's `owner:
 *   null` one on the next apply. Sending `owner: null` explicitly is what keeps a create
 *   idempotent under this vendor's default.
 *
 * ★ READ ANSWERS `Unowned(attrs)` ON EVERY MATCH (H1, alchemy-provider-standard). Paperless has no
 *   ownership marker this package could check — `owner` here is the estate's OWN prop, not proof
 *   of who created the row — so, per the house's 2026-09-21 decision, identical is not ours: a
 *   live match never adopts silently. `--adopt` (or `adopt(true)`) resolves it, same as any other
 *   marker-less API (upstream's `Snippet.ts#read`).
 *
 * ⛔ IDENTITY IS THE STORED `id`, NOT `name`/`owner`, ONCE A RESOURCE HAS STATE (PR 163, red-team
 *   HIGH finding). `diff` and `reconcile` used to re-derive identity from `news` alone on EVERY
 *   call — `fetchLive` located a live row by `(name, owner)` even when `output` (the engine's
 *   record of what this declaration last wrote, `Provider.ts#reconcile`'s `output` parameter) was
 *   right there holding the object's real id. Editing `name` (or `owner`, for the three owned
 *   families) on an already-deployed resource is the single most ordinary edit anyone would make
 *   — and it made `fetchLive(news)` miss the row it previously wrote, fall into the create branch,
 *   POST a SECOND object under the new name/owner, and leave the original permanently orphaned
 *   (`list()` always answers `[]` by design, so `nuke` can never find it either). `diff` reported
 *   a plain `{action:'update'}` — nothing told the operator this was about to duplicate and
 *   abandon an object.
 *
 *   The fix: once `output` is defined, `fetchLive` locates by `output.id` (a direct
 *   `GET {collection}/{id}/`), never by name — a changed `name`/`owner` becomes an ordinary PATCH
 *   of that same id (Paperless allows PATCHing both on all four types; documents keep their
 *   tag/type/path because the id never changes). `patchBody`/`matches` now compare `name` and
 *   (when `spec.owned !== false`) `owner` against the live row too, so the rename/re-own actually
 *   reaches the PATCH body — locating the right row was necessary but not sufficient. The
 *   name/owner-based `fetchByName` locate survives ONLY for the no-state path: a genuine first
 *   create, or the engine's own adoption probe (`provider.read`, called with `output: undefined`
 *   per `Plan.ts`'s adopt block) — `read` is unchanged and still locates by name for exactly that
 *   reason. If `output.id` no longer exists live (deleted out of band — by hand, or by another
 *   tool), `fetchLive` refuses loudly (`Effect.die`) rather than silently falling through to a
 *   create: a plan that would otherwise read as "ordinary update" instead names the id and tells
 *   the operator to adopt or clean up state, the same posture `immutable` already uses below for
 *   `CustomField.dataType`.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import type { PaperlessRow } from './client.ts';
import { paperless } from './client.ts';
import { guardBody } from './constraint-guard.ts';
import type { PaperlessBody } from './constraints.ts';
import { absentOn404, matchingLocate, ownerOf } from './matching-locate.ts';
import type { MatchingProps, MatchingSpec } from './matching-types.ts';

/** Re-exported so `tag.ts`/`document-type.ts`/`storage-path.ts`/`custom-field.ts` keep importing the contract from `./matching.ts` — only the shape itself lives in `matching-types.ts`, split out to hold the file-size cap. */
export type {
  FieldSpec,
  MatchingError,
  MatchingProps,
  MatchingRequirements,
  MatchingSpec,
} from './matching-types.ts';

/** Object equality good enough for this family's scalars, nullable ints and `extra_data` JSON. */
const sameValue = (a: unknown, b: unknown): boolean =>
  typeof a === 'object' && a !== null ? JSON.stringify(a) === JSON.stringify(b) : Object.is(a, b);

export const matchingOperations = <
  Props extends MatchingProps,
  Attributes extends { readonly id: number },
>(
  spec: MatchingSpec<Props, Attributes>,
) => {
  // ★ IDENTITY RESOLUTION LIVES IN `matching-locate.ts` (file-size cap) — `fetchByName` for the
  //   no-state path, `fetchLive` for the `output.id`-first switch this file's header describes.
  const { fetchByName, fetchById, fetchLive, objectPath } = matchingLocate<Props>(spec);

  /** ⚠️ ALWAYS NAME-BASED — this is `read`'s own contract (S7): find the object from props alone, with no `output` to consult. Unaffected by the identity switch above. */
  const read = (props: Props) =>
    fetchByName(props).pipe(
      Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
    );

  const readById = (props: Props, id: number) =>
    fetchById(id).pipe(
      Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
    );

  const createBody = (props: Props): PaperlessBody => {
    const out: PaperlessBody =
      spec.owned === false
        ? { name: props.name }
        : { name: props.name, owner: props.owner ?? null };
    for (const field of [...spec.fields, ...(spec.createOnly ?? [])]) {
      const value = field.prop(props);
      if (value !== undefined) out[field.key] = value;
    }
    return out;
  };

  /**
   * ⚠️ Only fields that DIFFER from the live row — a PATCH that repeats an unchanged value is
   *   still a write the audit log carries for nothing.
   * ⛔ `name` AND (WHEN OWNED) `owner` ARE COMPARED TOO, NOT JUST `spec.fields`. Locating the
   *   right row by `id` fixed WHERE the write lands; without this, a rename/re-own would still
   *   locate correctly and then send an empty-for-those-keys PATCH, so the live object's name or
   *   owner would silently never change (PR 163).
   */
  const patchBody = (props: Props, live: PaperlessRow): PaperlessBody => {
    const out: PaperlessBody = {};
    if (props.name !== live['name']) out['name'] = props.name;
    if (spec.owned !== false && ownerOf(live) !== (props.owner ?? undefined)) {
      out['owner'] = props.owner ?? null;
    }
    for (const field of spec.fields) {
      const value = field.prop(props);
      if (value !== undefined && !sameValue(value, field.live(live))) out[field.key] = value;
    }
    return out;
  };

  const matches = (props: Props, live: PaperlessRow): boolean => {
    if (props.name !== live['name']) return false;
    if (spec.owned !== false && ownerOf(live) !== (props.owner ?? undefined)) return false;
    return spec.fields.every((field) => {
      const value = field.prop(props);
      return value === undefined || sameValue(value, field.live(live));
    });
  };

  return {
    read,

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* fetchLive(news, output);
        if (live === undefined) return { action: 'update' } as const;
        const refusal = spec.immutable?.(live, news);
        if (refusal !== undefined) return yield* Effect.die(new Error(refusal));
        if (matches(news, live)) return { action: 'noop' } as const;
        return spec.endpoint.update === undefined
          ? ({ action: 'replace' } as const)
          : ({ action: 'update' } as const);
      }),

    reconcile: (news: Props, output: Attributes | undefined) =>
      Effect.gen(function* () {
        const before = yield* fetchLive(news, output);
        let id: number | undefined;
        if (before === undefined) {
          const body = createBody(news);
          yield* guardBody(spec.endpoint.create, body, true);
          yield* paperless('POST', `${spec.collection}/`, body);
        } else {
          id = typeof before['id'] === 'number' ? before['id'] : undefined;
          // ⚠️ RE-CHECKED HERE, NOT ONLY IN `diff` — an adoption's first reconcile can run with
          //   no prior `diff` at all, and `immutable` guards a write that would destroy data.
          const refusal = spec.immutable?.(before, news);
          if (refusal !== undefined) return yield* Effect.die(new Error(refusal));
          if (spec.endpoint.update !== undefined) {
            const body = patchBody(news, before);
            if (Object.keys(body).length > 0) {
              yield* guardBody(spec.endpoint.update, body, false);
              yield* paperless('PATCH', `${objectPath(before)}/`, body);
            }
          }
        }
        // ★ READ BACK BY id WHEN WE HAVE ONE — a just-PATCHed row is read back by the id we
        //   wrote to, not by (possibly just-changed) name, so a rename's own read-back cannot
        //   fail the way the write it follows no longer can either. A fresh create has no id yet
        //   to read back by, so that branch still reads back by the name it just created.
        const after = yield* id === undefined ? read(news) : readById(news, id);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              `${spec.describe(news)}: the write returned no error but the object is still absent.`,
            ),
          );
        }
        return after;
      }),

    /**
     * ⛔ `output.id` FIRST, SAME SWITCH AS `fetchLive` (PR 163 re-review). The engine always
     *   passes `output` here too (`Apply.ts`'s delete call sites all carry `output: attr`) —
     *   `olds` is only the PROPS as last persisted, which drifts from the live object exactly
     *   the way `news` did pre-fix: rename it out of band (by hand, or by another tool) after
     *   the last successful reconcile, and a name-only locate silently finds nothing, `destroy`
     *   returns as if there were nothing to delete, and the engine drops the state row anyway —
     *   reporting "deleted" while the live object survives, permanently orphaned (the same
     *   consequence `matching.ts`'s header describes for the original bug, on the delete path
     *   the original fix didn't touch). A 404 on the `output.id` itself is NOT an error here,
     *   unlike `fetchLive`'s die — it means the object is already gone, which is exactly the
     *   idempotent success `delete` is supposed to report (S11, alchemy-provider-standard).
     */
    destroy: (olds: Props, output: Attributes | undefined) =>
      Effect.gen(function* () {
        const live = output === undefined ? yield* fetchByName(olds) : yield* fetchById(output.id);
        if (live === undefined) return;
        yield* absentOn404(paperless('DELETE', `${objectPath(live)}/`));
      }),
  };
};

/** The five provider handlers for a spec'd Paperless taxonomy object, wired once. */
export const matchingHandlers = <
  Props extends MatchingProps,
  Attributes extends { readonly id: number },
>(
  spec: MatchingSpec<Props, Attributes>,
) => {
  const ops = matchingOperations(spec);
  return {
    /** ⚠️ `[]` — Paperless index endpoints return the whole estate; adoption stays explicit. */
    list: () => Effect.succeed([]),
    read: ({ olds }: { olds: Props }) =>
      ops
        .read(olds)
        .pipe(Effect.map((attrs) => (attrs === undefined ? undefined : Unowned(attrs)))),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      ops.diff(news, output),
    // ⛔ `output` IS WHAT MAKES THE IDENTITY FIX WORK (PR 163) — the engine always passes it
    //   (`Provider.ts#reconcile`), so it is optional here only so a test can still call
    //   `reconcile({ news })` for a from-nothing create without spelling out `output: undefined`.
    //   ⚠️ `| undefined` on the optional type itself, not just `?` — `exactOptionalPropertyTypes`
    //   otherwise refuses the engine's own `output: Attributes | undefined` at the call site.
    reconcile: ({ news, output }: { news: Props; output?: Attributes | undefined }) =>
      ops.reconcile(news, output),
    // ⚠️ `output` PASSED THROUGH, NOT DROPPED — see `destroy`'s own header above (PR 163
    //   re-review). Same `| undefined` reasoning as `reconcile` just above.
    delete: ({ olds, output }: { olds: Props; output?: Attributes | undefined }) =>
      ops.destroy(olds, output),
  };
};

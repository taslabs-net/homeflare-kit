/**
 * One shape for every Paperless taxonomy object (Tag, DocumentType, StoragePath, CustomField):
 * locate by `name__iexact` only while there is no prior state, identify the exact (name, owner),
 * create-or-update, never delete by default. Modelled on `../netbox/resource.ts`'s
 * `netboxOperations` and `../forgejo/resource.ts`'s `forgejoOperations`.
 *
 * 🔴 WHY THIS REPLACED `client.ts`'s HAND-ROLLED `HttpClient` CALLS (2026-09-24, decision 43).
 *   Measured against Tim's distilled research page 2026-09-23: upstream Alchemy only accepts
 *   providers that call `@distilled.cloud/<vendor>` operations and `catchTag` their typed errors
 *   — not a raw `fetch`/`HttpClient` client over a hand-maintained path table.
 *   `@distilled.cloud/paperless-ngx` (aliased onto `@homeflare/distilled-paperless-ngx@0.3.0` —
 *   docs/distilled-interim.md) covers every operation this family calls; its 404/400 shapes were
 *   already live-measured (kit PR 194) before this migration touched a resource file.
 *
 * ⛔ THE CREATE BODY ALWAYS CARRIES `owner`, NULL WHEN UNDECLARED. `OwnedObjectSerializer.create`
 *   sets the owner to the TOKEN USER when the field is absent from the body (Paperless-ngx
 *   `documents/serialisers.py:495-502` at v3.1.1) — omitting it the way NetBox's `prefix-form.ts`
 *   omits an undeclared foreign key would silently create an object owned by whichever credential
 *   ran the deploy, invisible to every other user and a second row beside the estate's `owner:
 *   null` one on the next apply. Sending `owner: null` explicitly is what keeps a create
 *   idempotent under this vendor's default. Unchanged by the transport swap.
 *
 * ★ READ ANSWERS `Unowned(attrs)` ON EVERY MATCH (H1, alchemy-provider-standard). Paperless has no
 *   ownership marker this package could check — `owner` here is the estate's OWN prop, not proof
 *   of who created the row — so, per the house's 2026-09-21 decision, identical is not ours: a
 *   live match never adopts silently.
 *
 * ⛔ IDENTITY IS THE STORED `id`, NOT `name`/`owner`, ONCE A RESOURCE HAS STATE (PR 163, red-team
 *   HIGH finding — see `matching-locate.ts`'s `fetchLive` for the fix and the full history). This
 *   migration keeps that fix byte-for-byte: only the wire call under `fetchByName`/`fetchById`
 *   changed, not the switch itself.
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { CredentialsFromEnv } from '@distilled.cloud/paperless-ngx/Credentials';
import type { PaperlessNgxOpContext } from '@distilled.cloud/paperless-ngx/Protocol';
import * as Effect from 'effect/Effect';
import { guardBody } from './constraint-guard.ts';
import type { PaperlessBody } from './constraints.ts';
import { fetchLive as identitySwitch, locateOne } from './matching-locate.ts';
import type { MatchingProps, MatchingSpec } from './matching-types.ts';

/** Re-exported so `tag.ts`/`document-type.ts`/`storage-path.ts`/`custom-field.ts` keep importing the contract from `./matching.ts` — only the shape itself lives in `matching-types.ts`, split out to hold the file-size cap. */
export type {
  FieldSpec,
  MatchingPage,
  MatchingProps,
  MatchingRequirements,
  MatchingSpec,
} from './matching-types.ts';
export { LOCATE_PAGE, soleMatch } from './matching-locate.ts';

/** Object equality good enough for this family's scalars, nullable ints and `extra_data` JSON. */
const sameValue = (a: unknown, b: unknown): boolean =>
  typeof a === 'object' && a !== null ? JSON.stringify(a) === JSON.stringify(b) : Object.is(a, b);

export const matchingOperations = <
  Props extends MatchingProps,
  Live extends { readonly id: number; readonly name: string },
  Attributes extends { readonly id: number },
  E,
>(
  spec: MatchingSpec<Props, Live, Attributes, E>,
) => {
  const ownerOf = (live: Live): number | undefined =>
    spec.owned === false || spec.ownerOf === undefined ? undefined : spec.ownerOf(live);

  const ownerMatches = (live: Live, props: Props): boolean =>
    spec.owned === false || spec.ownerOf === undefined
      ? true
      : spec.ownerOf(live) === (props.owner ?? undefined);

  /** ★ THE NO-STATE LOCATE — see matching-locate.ts's `locateOne` and this file's own header. */
  const fetchByName = (props: Props) =>
    locateOne(
      spec.list(props),
      spec.describe(props),
      (row) => row.name === props.name && ownerMatches(row, props),
    );

  /** Already folds a 404 — each resource file's own `.pipe(Effect.catchTag('NotFound', …))`. */
  const fetchById = spec.getById;

  const fetchLive = (props: Props, output: Attributes | undefined) =>
    identitySwitch(props, output, fetchByName, fetchById, spec.describe);

  /** ⚠️ ALWAYS NAME-BASED — this is `read`'s own contract (S7): find the object from props alone, with no `output` to consult. */
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

  /** ⚠️ Only fields that DIFFER from the live row. `name`/`owner` are compared too (PR 163). */
  const patchBody = (props: Props, live: Live): PaperlessBody => {
    const out: PaperlessBody = {};
    if (props.name !== live.name) out['name'] = props.name;
    if (spec.owned !== false && ownerOf(live) !== (props.owner ?? undefined)) {
      out['owner'] = props.owner ?? null;
    }
    for (const field of spec.fields) {
      const value = field.prop(props);
      if (value !== undefined && !sameValue(value, field.live(live))) out[field.key] = value;
    }
    return out;
  };

  const matches = (props: Props, live: Live): boolean => {
    if (props.name !== live.name) return false;
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
        return spec.update === undefined
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
          yield* spec.create(body);
        } else {
          id = before.id;
          const refusal = spec.immutable?.(before, news);
          if (refusal !== undefined) return yield* Effect.die(new Error(refusal));
          if (spec.update !== undefined) {
            const body = patchBody(news, before);
            if (Object.keys(body).length > 0) {
              yield* guardBody(spec.endpoint.update, body, false);
              yield* spec.update(id, body);
            }
          }
        }
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

    /** ⛔ `output.id` FIRST, SAME SWITCH AS `fetchLive` (PR 163 re-review). A 404 on `output.id` is idempotent success, not an error, unlike `fetchLive`'s die. */
    destroy: (olds: Props, output: Attributes | undefined) =>
      Effect.gen(function* () {
        const live = output === undefined ? yield* fetchByName(olds) : yield* fetchById(output.id);
        if (live === undefined) return;
        yield* spec.destroy(live.id);
      }),
  };
};

/**
 * The five provider handlers for a spec'd Paperless taxonomy object, wired once.
 *
 * ★ CREDENTIALS ARE PROVIDED HERE, ONCE, NOT BY EVERY CALLER — the same shape
 *   `netboxHandlers`/`forgejoHandlers` use. `CredentialsFromEnv` resolves `PAPERLESS_URL` /
 *   `PAPERLESS_TOKEN` on the calling fiber per request, so this closure keeps that laziness —
 *   nothing is captured at module load. ⛔ THE TOKEN IS NEVER A PROP.
 */
export const matchingHandlers = <
  Props extends MatchingProps,
  Live extends { readonly id: number; readonly name: string },
  Attributes extends { readonly id: number },
  E,
>(
  spec: MatchingSpec<Props, Live, Attributes, E>,
) => {
  const ops = matchingOperations(spec);
  const withCredentials = <A>(effect: Effect.Effect<A, E, PaperlessNgxOpContext>) =>
    Effect.provide(effect, CredentialsFromEnv);
  return {
    /** ⚠️ `[]` — Paperless index endpoints return the whole estate; adoption stays explicit. */
    list: () => Effect.succeed([]),
    read: ({ olds }: { olds: Props }) =>
      withCredentials(
        ops
          .read(olds)
          .pipe(Effect.map((attrs) => (attrs === undefined ? undefined : Unowned(attrs)))),
      ),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      withCredentials(ops.diff(news, output)),
    reconcile: ({ news, output }: { news: Props; output?: Attributes | undefined }) =>
      withCredentials(ops.reconcile(news, output)),
    delete: ({ olds, output }: { olds: Props; output?: Attributes | undefined }) =>
      withCredentials(ops.destroy(olds, output)),
  };
};

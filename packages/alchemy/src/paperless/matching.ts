/**
 * One shape for every Paperless taxonomy object (Tag, DocumentType, StoragePath, CustomField):
 * locate by `name__iexact`, identify the exact (name, owner), create-or-update, never delete by
 * default. Modelled on `../netbox/resource.ts`'s `netboxOperations`, with the differences this
 * unit's spec calls for.
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
 */
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Effect from 'effect/Effect';
import { type PaperlessError, PaperlessNotFound } from './errors.ts';
import type { PaperlessCredentialsError } from './credentials.ts';
import {
  type PaperlessList,
  type PaperlessRequirements,
  type PaperlessRow,
  paperless,
} from './client.ts';
import { guardBody } from './constraint-guard.ts';
import type { EndpointKey, PaperlessBody } from './constraints.ts';

/** = `client.ts`'s `PaperlessRequirements` — `HttpClient` and the credentials service both. */
export type MatchingRequirements = PaperlessRequirements;
type MatchingError = PaperlessError | PaperlessCredentialsError;

/** A wire field beyond `name`/`owner`: how to read it from props, and how to read it back. */
export interface FieldSpec<Props> {
  readonly key: string;
  readonly prop: (props: Props) => unknown;
  readonly live: (row: PaperlessRow) => unknown;
}

export interface MatchingProps {
  readonly name: string;
  /** `undefined` means undeclared — the create body still sends `owner: null` (see header). */
  readonly owner?: number;
}

export interface MatchingSpec<Props extends MatchingProps, Attributes> {
  /** `tags`, `document_types`, `storage_paths`, `custom_fields`. */
  readonly collection: string;
  /**
   * ⚠️ DEFAULT `true`. `Tag`, `DocumentType` and `StoragePath` extend Paperless-ngx's
   *   `OwnedObjectSerializer`; `CustomField` does not — its wire body has no `owner` key at all
   *   (measured against the v3.1.1 schema: `CustomFieldRequest` is `{name, data_type,
   *   extra_data}`). `false` stops `createBody` sending a field the vendor would silently ignore.
   */
  readonly owned?: boolean;
  /** Compared, PATCHed when they differ, and sent on create. */
  readonly fields: readonly FieldSpec<Props>[];
  /**
   * Sent on CREATE only — never compared, never PATCHed. `CustomField.dataType` (custom-field.ts)
   * is the one user: it must reach the create body, but `immutable` is what refuses a later
   * change, and `matches`/`patchBody` must never see it as ordinary drift.
   */
  readonly createOnly?: readonly FieldSpec<Props>[];
  readonly attributes: (live: PaperlessRow, props: Props) => Attributes | undefined;
  readonly endpoint: { readonly create: EndpointKey; readonly update?: EndpointKey };
  readonly describe: (props: Props) => string;
  /**
   * A field this object refuses to change once set — `CustomField.dataType` (custom-field.ts):
   * a replace would delete that field's value on every document, so neither a PATCH nor a
   * replace is acceptable. Return the refusal message, or `undefined` when unchanged. Checked in
   * `diff` (plan time) and again in `reconcile` (an adoption `diff` never saw).
   */
  readonly immutable?: (live: PaperlessRow, props: Props) => string | undefined;
}

/** ⚠️ Only 404 folds to "absent" — a 401/403 is never read as absent (acceptance criteria). */
const absentOn404 = <A>(io: Effect.Effect<A, MatchingError, MatchingRequirements>) =>
  io.pipe(
    Effect.catchIf(
      (cause): cause is PaperlessNotFound => cause instanceof PaperlessNotFound,
      () => Effect.succeed(undefined as A),
    ),
  );

/** ★ Wide enough to see every case-variant candidate `name__iexact` returns; a natural key past it is not one. */
const LOCATE_PAGE = 20;

const ownerOf = (row: PaperlessRow): number | undefined =>
  typeof row['owner'] === 'number' ? row['owner'] : undefined;

/** Object equality good enough for this family's scalars, nullable ints and `extra_data` JSON. */
const sameValue = (a: unknown, b: unknown): boolean =>
  typeof a === 'object' && a !== null ? JSON.stringify(a) === JSON.stringify(b) : Object.is(a, b);

export const matchingOperations = <Props extends MatchingProps, Attributes>(
  spec: MatchingSpec<Props, Attributes>,
) => {
  const fetchLive = (props: Props) =>
    absentOn404(
      paperless<PaperlessList<PaperlessRow>>(
        'GET',
        `${spec.collection}/?name__iexact=${encodeURIComponent(props.name)}&page_size=${String(LOCATE_PAGE)}`,
      ),
    ).pipe(
      Effect.map((list) => {
        if (list !== undefined && list.count > LOCATE_PAGE) {
          throw new Error(
            `${spec.describe(props)}: name__iexact matched ${String(list.count)} rows, more than ` +
              `the ${String(LOCATE_PAGE)}-row page this reads. Narrow the name rather than paging.`,
          );
        }
        const rows = (list?.results ?? []).filter(
          (row) => row['name'] === props.name && ownerOf(row) === (props.owner ?? undefined),
        );
        if (rows.length > 1) {
          throw new Error(
            `${spec.describe(props)}: matched ${String(rows.length)} Paperless objects with the same (name, owner).`,
          );
        }
        return rows[0];
      }),
    );

  const objectPath = (live: PaperlessRow): string => `${spec.collection}/${String(live['id'])}`;

  const read = (props: Props) =>
    fetchLive(props).pipe(
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

  /** ⚠️ Only fields that DIFFER from the live row — a PATCH that repeats an unchanged value is still a write the audit log carries for nothing. */
  const patchBody = (props: Props, live: PaperlessRow): PaperlessBody => {
    const out: PaperlessBody = {};
    for (const field of spec.fields) {
      const value = field.prop(props);
      if (value !== undefined && !sameValue(value, field.live(live))) out[field.key] = value;
    }
    return out;
  };

  const matches = (props: Props, live: PaperlessRow): boolean =>
    spec.fields.every((field) => {
      const value = field.prop(props);
      return value === undefined || sameValue(value, field.live(live));
    });

  return {
    read,

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* fetchLive(news);
        if (live === undefined) return { action: 'update' } as const;
        const refusal = spec.immutable?.(live, news);
        if (refusal !== undefined) return yield* Effect.die(new Error(refusal));
        if (matches(news, live)) return { action: 'noop' } as const;
        return spec.endpoint.update === undefined
          ? ({ action: 'replace' } as const)
          : ({ action: 'update' } as const);
      }),

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const before = yield* fetchLive(news);
        if (before === undefined) {
          const body = createBody(news);
          yield* guardBody(spec.endpoint.create, body, true);
          yield* paperless('POST', `${spec.collection}/`, body);
        } else {
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
        const after = yield* read(news);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              `${spec.describe(news)}: the write returned no error but the object is still absent.`,
            ),
          );
        }
        return after;
      }),

    destroy: (olds: Props) =>
      Effect.gen(function* () {
        const live = yield* fetchLive(olds);
        if (live === undefined) return;
        yield* absentOn404(paperless('DELETE', `${objectPath(live)}/`));
      }),
  };
};

/** The five provider handlers for a spec'd Paperless taxonomy object, wired once. */
export const matchingHandlers = <Props extends MatchingProps, Attributes extends object>(
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
    reconcile: ({ news }: { news: Props }) => ops.reconcile(news),
    delete: ({ olds }: { olds: Props }) => ops.destroy(olds),
  };
};

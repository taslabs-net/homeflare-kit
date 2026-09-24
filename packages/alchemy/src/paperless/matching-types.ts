/**
 * The contract every Paperless taxonomy object (Tag, DocumentType, StoragePath, CustomField)
 * declares against `matching.ts`'s generic lifecycle — split into its own file so `matching.ts`
 * itself (the identity/locate/create/patch logic the PR 163 red-team HIGH finding is about) stays
 * under the house's 250-line-per-file cap. See `matching.ts`'s header for the identity design
 * (`output.id` once a resource has state) this `MatchingSpec` shape supports.
 *
 * 🔴 MOVED ONTO `@distilled.cloud/paperless-ngx` (2026-09-24, decision 43) — `Live` is now
 *   whatever a distilled operation decodes (a `tags.Tag`, a `documentTypes.DocumentType`, …), no
 *   more untyped `PaperlessRow`. `E` is left to each resource file to declare (the union of the
 *   distilled operations it actually calls), so a call site's precise per-operation error union
 *   flows straight through instead of being widened by hand here — the same split
 *   `../netbox/resource.ts` and `../forgejo/resource.ts` use.
 */
import type { PaperlessNgxOpContext } from '@distilled.cloud/paperless-ngx/Protocol';
import type * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { EndpointKey, PaperlessBody } from './constraints.ts';

/**
 * What a CONSUMING STACK must provide. `matchingHandlers` (matching.ts) bakes in
 * `CredentialsFromEnv` itself, the same way `netboxHandlers`/`forgejoHandlers` do, so only the
 * transport is left — see matching.ts's own note on `withCredentials`.
 */
export type MatchingRequirements = HttpClient.HttpClient;

/** A wire field beyond `name`/`owner`: how to read it from props, and how to read it back. */
export interface FieldSpec<Props, Live> {
  readonly key: string;
  readonly prop: (props: Props) => unknown;
  readonly live: (row: Live) => unknown;
}

export interface MatchingProps {
  readonly name: string;
  /** `undefined` means undeclared — the create body still sends `owner: null` (see matching.ts's header). */
  readonly owner?: number;
}

/** The shape every `list*` distilled operation this family calls answers. */
export interface MatchingPage<Live> {
  readonly count: number;
  readonly results: readonly Live[];
}

export interface MatchingSpec<
  Props extends MatchingProps,
  Live extends { readonly id: number; readonly name: string },
  Attributes extends { readonly id: number },
  E,
> {
  /**
   * ⚠️ DEFAULT `true`. `Tag`, `DocumentType` and `StoragePath` extend Paperless-ngx's
   *   `OwnedObjectSerializer`; `CustomField` does not — its wire body has no `owner` key at all
   *   (measured against the v3.1.1 schema: `CustomFieldRequest` is `{name, data_type,
   *   extra_data}`). `false` stops `createBody` sending a field the vendor would silently ignore,
   *   and `ownerOf` need not be declared.
   */
  readonly owned?: boolean;
  /** Compared, PATCHed when they differ, and sent on create. */
  readonly fields: readonly FieldSpec<Props, Live>[];
  /**
   * Sent on CREATE only — never compared, never PATCHed. `CustomField.dataType` (custom-field.ts)
   * is the one user: it must reach the create body, but `immutable` is what refuses a later
   * change, and `matches`/`patchBody` must never see it as ordinary drift.
   */
  readonly createOnly?: readonly FieldSpec<Props, Live>[];
  readonly attributes: (live: Live, props: Props) => Attributes | undefined;
  /** Reads the live row's owner. Required unless `owned === false` (CustomField). */
  readonly ownerOf?: (live: Live) => number | undefined;
  /** The generated constraint table to check each body against, by endpoint key. */
  readonly endpoint: { readonly create: EndpointKey; readonly update?: EndpointKey };
  /** For `soleMatch`'s message and for read-back failures. */
  readonly describe: (props: Props) => string;
  /**
   * A field this object refuses to change once set — `CustomField.dataType` (custom-field.ts):
   * a replace would delete that field's value on every document, so neither a PATCH nor a
   * replace is acceptable. Return the refusal message, or `undefined` when unchanged. Checked in
   * `diff` (plan time) and again in `reconcile` (an adoption `diff` never saw).
   */
  readonly immutable?: (live: Live, props: Props) => string | undefined;

  /** `name__iexact` + `page_size` — wired per resource file (`listTags`, `listDocumentTypes`, …). */
  readonly list: (props: Props) => Effect.Effect<MatchingPage<Live>, E, PaperlessNgxOpContext>;
  /** Already folds the SDK's `NotFound` to `undefined` — each resource file's own `.pipe(Effect.catchTag('NotFound', …))`. */
  readonly getById: (id: number) => Effect.Effect<Live | undefined, E, PaperlessNgxOpContext>;
  readonly create: (body: PaperlessBody) => Effect.Effect<Live, E, PaperlessNgxOpContext>;
  /** Absent would mean create-only-and-never-updated; every family here declares one. */
  readonly update?: (
    id: number,
    body: PaperlessBody,
  ) => Effect.Effect<Live, E, PaperlessNgxOpContext>;
  readonly destroy: (id: number) => Effect.Effect<unknown, E, PaperlessNgxOpContext>;
}

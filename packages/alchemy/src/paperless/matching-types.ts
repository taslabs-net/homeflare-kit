/**
 * The contract every Paperless taxonomy object (Tag, DocumentType, StoragePath, CustomField)
 * declares against `matching.ts`'s generic lifecycle — split into its own file so `matching.ts`
 * itself (the identity/locate/create/patch logic the PR 163 red-team HIGH finding is about) stays
 * under the house's 250-line-per-file cap. See `matching.ts`'s header for the identity design
 * (`output.id` once a resource has state) this `MatchingSpec` shape supports.
 */
import type { PaperlessCredentialsError } from './credentials.ts';
import type { PaperlessError } from './errors.ts';
import type { PaperlessRequirements, PaperlessRow } from './client.ts';
import type { EndpointKey } from './constraints.ts';

/** = `client.ts`'s `PaperlessRequirements` — `HttpClient` and the credentials service both. */
export type MatchingRequirements = PaperlessRequirements;
export type MatchingError = PaperlessError | PaperlessCredentialsError;

/** A wire field beyond `name`/`owner`: how to read it from props, and how to read it back. */
export interface FieldSpec<Props> {
  readonly key: string;
  readonly prop: (props: Props) => unknown;
  readonly live: (row: PaperlessRow) => unknown;
}

export interface MatchingProps {
  readonly name: string;
  /** `undefined` means undeclared — the create body still sends `owner: null` (see matching.ts's header). */
  readonly owner?: number;
}

export interface MatchingSpec<
  Props extends MatchingProps,
  Attributes extends { readonly id: number },
> {
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

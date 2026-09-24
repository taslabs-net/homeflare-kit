/**
 * `Paperless.CustomField` — a Paperless-ngx custom field, create-or-update and never deleted.
 *
 * ⛔ `dataType` IS CREATE-ONLY, ENFORCED AT PLAN TIME, NEVER A PATCH AND NEVER A REPLACE. A
 *   replace would delete this id and create a new one — and Paperless deletes the field's VALUE
 *   on every document when its custom field is deleted. `matching.ts`'s `immutable` hook carries
 *   this refusal generically; `dataType` is simply never listed in `fields`, so nothing in
 *   `matching.ts` ever builds a PATCH body that includes it.
 *
 * ⛔ NO `owner` FIELD, AND NO `ownerOf` SPEC ENTRY. Unlike `Tag`/`DocumentType`/`StoragePath`,
 *   `CustomField` does not extend Paperless-ngx's `OwnedObjectSerializer` — its wire body is
 *   exactly `{name, data_type, extra_data}` (measured against the v3.1.1 schema, and confirmed
 *   again in `@distilled.cloud/paperless-ngx`'s generated `custom_fields.ts`, which has no
 *   `owner` field either). `owned: false` stops `matching.ts` sending or comparing one.
 *
 * ⚠️ `CustomField.select_options` (the vendor's own rule for a `select` field's option list) is
 *   not in the served schema at all, so it is recorded here and NOT enforced (groundTruth). See
 *   `tag.ts`'s header for the 2026-09-24 transport migration this file follows.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as customFields from '@distilled.cloud/paperless-ngx/custom_fields';
import * as Effect from 'effect/Effect';
import type { PaperlessCustomFieldRequest } from './generated/types/custom-fields.ts';
import {
  LOCATE_PAGE,
  type MatchingRequirements,
  type MatchingSpec,
  matchingHandlers,
} from './matching.ts';

export interface CustomFieldProps {
  /** ⚠️ maxLength 128 (generated constraint table). CustomField's name is globally unique (models.py:1169), with no owner to further scope it. */
  name: string;
  /** ⛔ CREATE-ONLY — see this file's header. `select`'s own option list (`select_options`) is not in the vendor schema and is unenforced here. */
  dataType: PaperlessCustomFieldRequest['data_type'];
  /** Arbitrary JSON the vendor attaches no schema to (e.g. a `select` field's option list). */
  extraData?: unknown;
}

export interface CustomFieldAttributes {
  id: number;
  name: string;
  dataType: string;
  extraData: unknown;
}

export interface CustomField extends Resource<
  'Paperless.CustomField',
  CustomFieldProps,
  CustomFieldAttributes,
  never,
  MatchingRequirements
> {}

export const CustomField = Resource<CustomField>('Paperless.CustomField', {
  defaultRemovalPolicy: 'retain',
});

/**
 * ⛔ EXTRACTED SO IT CAN BE TESTED WITHOUT A SERVER (custom-field.test.ts). `Pick<…, 'data_type'>`
 *   rather than the full `CustomField`, so a test fixture need not spell out `name`/`document_count`.
 */
export const dataTypeImmutable = (
  live: Pick<customFields.CustomField, 'data_type'>,
  props: CustomFieldProps,
): string | undefined =>
  live.data_type !== props.dataType
    ? `Paperless.CustomField "${props.name}": data_type is create-only (live: ${live.data_type}, ` +
      `declared: ${props.dataType}). Changing it would delete this field's value on every ` +
      'document. Create a new custom field instead, and retire this one by hand.'
    : undefined;

/** ★ Exported for direct testing — see tag.ts's own note on this seam. */
export const spec: MatchingSpec<
  CustomFieldProps,
  customFields.CustomField,
  CustomFieldAttributes,
  | customFields.CreateCustomFieldError
  | customFields.GetCustomFieldError
  | customFields.ListCustomFieldsError
  | customFields.UpdateCustomFieldsPartialError
  | customFields.CustomFieldsDestroyError
> = {
  attributes: (live, props) => ({
    dataType: live.data_type ?? props.dataType,
    extraData: live.extra_data,
    id: live.id,
    name: live.name,
  }),
  create: (body) =>
    customFields.createCustomField(body as unknown as customFields.CreateCustomFieldRequest),
  createOnly: [{ key: 'data_type', live: (r) => r.data_type, prop: (p) => p.dataType }],
  describe: (props) => `custom_fields ${props.name}`,
  destroy: (id) => customFields.customFieldsDestroy({ id }),
  endpoint: {
    create: 'paperless:POST /api/custom_fields/',
    update: 'paperless:PATCH /api/custom_fields/{id}/',
  },
  fields: [{ key: 'extra_data', live: (r) => r.extra_data, prop: (p) => p.extraData }],
  getById: (id) =>
    customFields
      .getCustomField({ id })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  immutable: dataTypeImmutable,
  list: (props) =>
    customFields.listCustomFields({ name__iexact: props.name, page_size: LOCATE_PAGE }),
  owned: false,
  update: (id, body) =>
    customFields.updateCustomFieldsPartial({
      ...(body as unknown as Omit<customFields.UpdateCustomFieldsPartialRequest, 'id'>),
      id,
    }),
};

export const customFieldHandlers = matchingHandlers(spec);

export const CustomFieldProvider = () =>
  Provider.effect(CustomField, Effect.succeed(CustomField.Provider.of(customFieldHandlers)));

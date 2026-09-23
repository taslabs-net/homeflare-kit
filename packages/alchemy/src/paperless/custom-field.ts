/**
 * `Paperless.CustomField` — a Paperless-ngx custom field, create-or-update and never deleted.
 *
 * ⛔ `dataType` IS CREATE-ONLY, ENFORCED AT PLAN TIME, NEVER A PATCH AND NEVER A REPLACE. A
 *   replace would delete this id and create a new one — and Paperless deletes the field's VALUE
 *   on every document when its custom field is deleted. `matching.ts`'s `immutable` hook carries
 *   this refusal generically; `dataType` is simply never listed in `fields`, so nothing in
 *   `matching.ts` ever builds a PATCH body that includes it.
 *
 * ⛔ NO `owner` FIELD. Unlike `Tag`/`DocumentType`/`StoragePath`, `CustomField` does not extend
 *   Paperless-ngx's `OwnedObjectSerializer` — its wire body is exactly `{name, data_type,
 *   extra_data}` (measured against the v3.1.1 schema). `owned: false` stops `matching.ts`
 *   sending a field the vendor's serializer does not declare.
 *
 * ⚠️ `CustomField.select_options` (the vendor's own rule for a `select` field's option list) is
 *   not in the served schema at all, so it is recorded here and NOT enforced (groundTruth).
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PaperlessCustomFieldRequest } from './generated/types/custom-fields.ts';
import type { PaperlessRow } from './client.ts';
import { type MatchingRequirements, matchingHandlers } from './matching.ts';

export interface CustomFieldProps {
  /** ⚠️ maxLength 128 (generated constraint table). The locate key — CustomField's name is globally unique (models.py:1169), with no owner to further scope it. */
  name: string;
  /**
   * ⛔ CREATE-ONLY — see this file's header. `select`'s own option list
   *   (`select_options`) is not in the vendor schema and is unenforced here.
   */
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
 * ⛔ EXTRACTED SO IT CAN BE TESTED WITHOUT A SERVER (custom-field.test.ts) — the same reason
 *   `../netbox/prefix-form.ts` pulls its body/matches functions out of `prefix.ts`.
 */
export const dataTypeImmutable = (
  live: PaperlessRow,
  props: CustomFieldProps,
): string | undefined =>
  typeof live['data_type'] === 'string' && live['data_type'] !== props.dataType
    ? `Paperless.CustomField "${props.name}": data_type is create-only (live: ${live['data_type']}, ` +
      `declared: ${props.dataType}). Changing it would delete this field's value on every ` +
      'document. Create a new custom field instead, and retire this one by hand.'
    : undefined;

/** ⚠️ Exported (not through index.ts) so custom-field.test.ts can drive the real lifecycle. */
export const customFieldHandlers = matchingHandlers<CustomFieldProps, CustomFieldAttributes>({
  attributes: (live, props) => {
    const id = live['id'];
    if (typeof id !== 'number') return undefined;
    return {
      dataType: typeof live['data_type'] === 'string' ? live['data_type'] : props.dataType,
      extraData: live['extra_data'],
      id,
      name: typeof live['name'] === 'string' ? live['name'] : props.name,
    };
  },
  collection: 'custom_fields',
  describe: (props) => `custom_fields ${props.name}`,
  endpoint: {
    create: 'paperless:POST /api/custom_fields/',
    update: 'paperless:PATCH /api/custom_fields/{id}/',
  },
  createOnly: [{ key: 'data_type', live: (r) => r['data_type'], prop: (p) => p.dataType }],
  fields: [{ key: 'extra_data', live: (r) => r['extra_data'], prop: (p) => p.extraData }],
  immutable: dataTypeImmutable,
  owned: false,
});

export const CustomFieldProvider = () =>
  Provider.effect(CustomField, Effect.succeed(CustomField.Provider.of(customFieldHandlers)));

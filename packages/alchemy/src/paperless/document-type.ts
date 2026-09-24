/**
 * `Paperless.DocumentType` — a Paperless-ngx document type, create-or-update and never deleted.
 * Same shape as `tag.ts` minus `color`/`isInboxTag`/`parent` — see that file's header for why
 * `matchingAlgorithm`'s type comes off the generated request type rather than being retyped, and
 * for the 2026-09-24 transport migration this file follows exactly.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as documentTypes from '@distilled.cloud/paperless-ngx/document_types';
import * as Effect from 'effect/Effect';
import type { PaperlessDocumentTypeRequest } from './generated/types/document-types.ts';
import {
  LOCATE_PAGE,
  type MatchingRequirements,
  type MatchingSpec,
  matchingHandlers,
} from './matching.ts';

export interface DocumentTypeProps {
  /** ⚠️ maxLength 128 (generated constraint table). The locate key. */
  name: string;
  owner?: number;
  /** ⚠️ maxLength 256. */
  match?: string;
  matchingAlgorithm?: PaperlessDocumentTypeRequest['matching_algorithm'];
  isInsensitive?: boolean;
}

export interface DocumentTypeAttributes {
  id: number;
  name: string;
  match: string;
  matchingAlgorithm: number;
  isInsensitive: boolean;
  owner: number | undefined;
}

export interface DocumentType extends Resource<
  'Paperless.DocumentType',
  DocumentTypeProps,
  DocumentTypeAttributes,
  never,
  MatchingRequirements
> {}

export const DocumentType = Resource<DocumentType>('Paperless.DocumentType', {
  defaultRemovalPolicy: 'retain',
});

/** ★ Exported for direct testing — see tag.ts's own note on this seam. */
export const spec: MatchingSpec<
  DocumentTypeProps,
  documentTypes.DocumentType,
  DocumentTypeAttributes,
  | documentTypes.CreateDocumentTypeError
  | documentTypes.GetDocumentTypeError
  | documentTypes.ListDocumentTypesError
  | documentTypes.UpdateDocumentTypesPartialError
  | documentTypes.DocumentTypesDestroyError
> = {
  attributes: (live, props) => ({
    id: live.id,
    isInsensitive: live.is_insensitive === true,
    match: live.match ?? '',
    matchingAlgorithm: live.matching_algorithm ?? 0,
    name: live.name,
    owner: live.owner ?? undefined,
  }),
  create: (body) =>
    documentTypes.createDocumentType(body as unknown as documentTypes.CreateDocumentTypeRequest),
  describe: (props) => `document_types ${props.name}`,
  destroy: (id) => documentTypes.documentTypesDestroy({ id }),
  endpoint: {
    create: 'paperless:POST /api/document_types/',
    update: 'paperless:PATCH /api/document_types/{id}/',
  },
  fields: [
    { key: 'match', live: (r) => r.match, prop: (p) => p.match },
    {
      key: 'matching_algorithm',
      live: (r) => r.matching_algorithm,
      prop: (p) => p.matchingAlgorithm,
    },
    { key: 'is_insensitive', live: (r) => r.is_insensitive, prop: (p) => p.isInsensitive },
  ],
  getById: (id) =>
    documentTypes
      .getDocumentType({ id })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  list: (props) =>
    documentTypes.listDocumentTypes({ name__iexact: props.name, page_size: LOCATE_PAGE }),
  ownerOf: (live) => live.owner ?? undefined,
  update: (id, body) =>
    documentTypes.updateDocumentTypesPartial({
      ...(body as unknown as Omit<documentTypes.UpdateDocumentTypesPartialRequest, 'id'>),
      id,
    }),
};

export const handlers = matchingHandlers(spec);

export const DocumentTypeProvider = () =>
  Provider.effect(DocumentType, Effect.succeed(DocumentType.Provider.of(handlers)));

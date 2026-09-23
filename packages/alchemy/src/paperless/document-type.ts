/**
 * `Paperless.DocumentType` — a Paperless-ngx document type, create-or-update and never deleted.
 * Same shape as `tag.ts` minus `color`/`isInboxTag`/`parent` — see that file's header for why
 * `matchingAlgorithm`'s type comes off the generated request type rather than being retyped.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PaperlessDocumentTypeRequest } from './generated/types/document-types.ts';
import { type MatchingProps, type MatchingRequirements, matchingHandlers } from './matching.ts';

export interface DocumentTypeProps extends MatchingProps {
  /** ⚠️ maxLength 128 (generated constraint table). The locate key. */
  name: string;
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

const handlers = matchingHandlers<DocumentTypeProps, DocumentTypeAttributes>({
  attributes: (live, props) => {
    const id = live['id'];
    if (typeof id !== 'number') return undefined;
    return {
      id,
      isInsensitive: live['is_insensitive'] === true,
      match: typeof live['match'] === 'string' ? live['match'] : '',
      matchingAlgorithm:
        typeof live['matching_algorithm'] === 'number' ? live['matching_algorithm'] : 0,
      name: typeof live['name'] === 'string' ? live['name'] : props.name,
      owner: typeof live['owner'] === 'number' ? live['owner'] : undefined,
    };
  },
  collection: 'document_types',
  describe: (props) => `document_types ${props.name}`,
  endpoint: {
    create: 'paperless:POST /api/document_types/',
    update: 'paperless:PATCH /api/document_types/{id}/',
  },
  fields: [
    { key: 'match', live: (r) => r['match'], prop: (p) => p.match },
    {
      key: 'matching_algorithm',
      live: (r) => r['matching_algorithm'],
      prop: (p) => p.matchingAlgorithm,
    },
    { key: 'is_insensitive', live: (r) => r['is_insensitive'], prop: (p) => p.isInsensitive },
  ],
});

export const DocumentTypeProvider = () =>
  Provider.effect(DocumentType, Effect.succeed(DocumentType.Provider.of(handlers)));

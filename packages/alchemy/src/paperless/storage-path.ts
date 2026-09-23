/**
 * `Paperless.StoragePath` — a Paperless-ngx storage path template, create-or-update and never
 * deleted. Same shape as `document-type.ts` plus the vendor-required `path` template string.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PaperlessStoragePathRequest } from './generated/types/storage-paths.ts';
import { type MatchingProps, type MatchingRequirements, matchingHandlers } from './matching.ts';

export interface StoragePathProps extends MatchingProps {
  /** ⚠️ maxLength 128 (generated constraint table). The locate key. */
  name: string;
  /** ⚠️ minLength 1 (generated table). Paperless's storage-path template syntax, e.g. `{correspondent}/{title}`. */
  path: string;
  /** ⚠️ maxLength 256. */
  match?: string;
  matchingAlgorithm?: PaperlessStoragePathRequest['matching_algorithm'];
  isInsensitive?: boolean;
}

export interface StoragePathAttributes {
  id: number;
  name: string;
  path: string;
  match: string;
  matchingAlgorithm: number;
  isInsensitive: boolean;
  owner: number | undefined;
}

export interface StoragePath extends Resource<
  'Paperless.StoragePath',
  StoragePathProps,
  StoragePathAttributes,
  never,
  MatchingRequirements
> {}

export const StoragePath = Resource<StoragePath>('Paperless.StoragePath', {
  defaultRemovalPolicy: 'retain',
});

const handlers = matchingHandlers<StoragePathProps, StoragePathAttributes>({
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
      path: typeof live['path'] === 'string' ? live['path'] : props.path,
    };
  },
  collection: 'storage_paths',
  describe: (props) => `storage_paths ${props.name}`,
  endpoint: {
    create: 'paperless:POST /api/storage_paths/',
    update: 'paperless:PATCH /api/storage_paths/{id}/',
  },
  fields: [
    { key: 'path', live: (r) => r['path'], prop: (p) => p.path },
    { key: 'match', live: (r) => r['match'], prop: (p) => p.match },
    {
      key: 'matching_algorithm',
      live: (r) => r['matching_algorithm'],
      prop: (p) => p.matchingAlgorithm,
    },
    { key: 'is_insensitive', live: (r) => r['is_insensitive'], prop: (p) => p.isInsensitive },
  ],
});

export const StoragePathProvider = () =>
  Provider.effect(StoragePath, Effect.succeed(StoragePath.Provider.of(handlers)));

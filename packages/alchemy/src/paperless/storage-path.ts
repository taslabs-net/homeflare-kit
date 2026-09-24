/**
 * `Paperless.StoragePath` — a Paperless-ngx storage path template, create-or-update and never
 * deleted. Same shape as `document-type.ts` plus the vendor-required `path` template string; see
 * `tag.ts`'s header for the 2026-09-24 transport migration this file follows exactly.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as storagePaths from '@distilled.cloud/paperless-ngx/storage_paths';
import * as Effect from 'effect/Effect';
import type { PaperlessStoragePathRequest } from './generated/types/storage-paths.ts';
import {
  LOCATE_PAGE,
  type MatchingRequirements,
  type MatchingSpec,
  matchingHandlers,
} from './matching.ts';

export interface StoragePathProps {
  /** ⚠️ maxLength 128 (generated constraint table). The locate key. */
  name: string;
  owner?: number;
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

/** ★ Exported for direct testing — see tag.ts's own note on this seam. */
export const spec: MatchingSpec<
  StoragePathProps,
  storagePaths.StoragePath,
  StoragePathAttributes,
  | storagePaths.CreateStoragePathError
  | storagePaths.GetStoragePathError
  | storagePaths.ListStoragePathsError
  | storagePaths.UpdateStoragePathsPartialError
  | storagePaths.StoragePathsDestroyError
> = {
  attributes: (live, props) => ({
    id: live.id,
    isInsensitive: live.is_insensitive === true,
    match: live.match ?? '',
    matchingAlgorithm: live.matching_algorithm ?? 0,
    name: live.name,
    owner: live.owner ?? undefined,
    path: live.path,
  }),
  create: (body) =>
    storagePaths.createStoragePath(body as unknown as storagePaths.CreateStoragePathRequest),
  describe: (props) => `storage_paths ${props.name}`,
  destroy: (id) => storagePaths.storagePathsDestroy({ id }),
  endpoint: {
    create: 'paperless:POST /api/storage_paths/',
    update: 'paperless:PATCH /api/storage_paths/{id}/',
  },
  fields: [
    { key: 'path', live: (r) => r.path, prop: (p) => p.path },
    { key: 'match', live: (r) => r.match, prop: (p) => p.match },
    {
      key: 'matching_algorithm',
      live: (r) => r.matching_algorithm,
      prop: (p) => p.matchingAlgorithm,
    },
    { key: 'is_insensitive', live: (r) => r.is_insensitive, prop: (p) => p.isInsensitive },
  ],
  getById: (id) =>
    storagePaths
      .getStoragePath({ id })
      .pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  list: (props) =>
    storagePaths.listStoragePaths({ name__iexact: props.name, page_size: LOCATE_PAGE }),
  ownerOf: (live) => live.owner ?? undefined,
  update: (id, body) =>
    storagePaths.updateStoragePathsPartial({
      ...(body as unknown as Omit<storagePaths.UpdateStoragePathsPartialRequest, 'id'>),
      id,
    }),
};

export const handlers = matchingHandlers(spec);

export const StoragePathProvider = () =>
  Provider.effect(StoragePath, Effect.succeed(StoragePath.Provider.of(handlers)));

/**
 * `Paperless.Tag` — a Paperless-ngx tag, create-or-update and never deleted by default.
 *
 * ★ `matchingAlgorithm` AND THE OTHER ENUM-SHAPED FIELDS ARE INDEXED OFF THE GENERATED REQUEST
 *   TYPE (`PaperlessTagRequest['matching_algorithm']`), NEVER RETYPED — see this family's header
 *   in `docs/paperless.md`. Unchanged by the 2026-09-24 transport migration below: that generated
 *   table is `codegen/paperless.ts`'s own concern, not `@distilled.cloud/paperless-ngx`'s.
 *
 * ⛔ NO CREDENTIAL IS A PROP. `PAPERLESS_URL`/`PAPERLESS_TOKEN` come from
 *   `@distilled.cloud/paperless-ngx`'s `CredentialsFromEnv` (matching.ts), the same two variable
 *   names the retired hand-rolled `credentials.ts` read.
 * ⛔ `defaultRemovalPolicy: 'retain'` — the reconciler this replaces never deletes taxonomy, and
 *   a tag's id is referenced by every document it is attached to.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as tags from '@distilled.cloud/paperless-ngx/tags';
import * as Effect from 'effect/Effect';
import type { PaperlessTagRequest } from './generated/types/tags.ts';
import {
  LOCATE_PAGE,
  type MatchingRequirements,
  type MatchingSpec,
  matchingHandlers,
} from './matching.ts';

export interface TagProps {
  /** ⚠️ maxLength 128 (generated constraint table). The locate key — see matching.ts's header. */
  name: string;
  owner?: number;
  /** ⚠️ minLength 1, maxLength 7 (a CSS hex color, generated table doesn't enforce the `#`). */
  color?: string;
  /** ⚠️ maxLength 256. The text or pattern documents are matched against. */
  match?: string;
  matchingAlgorithm?: PaperlessTagRequest['matching_algorithm'];
  isInsensitive?: boolean;
  /** Marks this tag as an inbox tag: newly consumed documents are tagged with it. */
  isInboxTag?: boolean;
  /** Another `Paperless.Tag`'s id — Paperless allows one level of tag nesting. */
  parent?: number;
}

export interface TagAttributes {
  id: number;
  name: string;
  color: string;
  match: string;
  matchingAlgorithm: number;
  isInsensitive: boolean;
  isInboxTag: boolean;
  owner: number | undefined;
  parent: number | undefined;
}

export interface Tag extends Resource<
  'Paperless.Tag',
  TagProps,
  TagAttributes,
  never,
  MatchingRequirements
> {}

export const Tag = Resource<Tag>('Paperless.Tag', { defaultRemovalPolicy: 'retain' });

/**
 * ★ EXPORTED, NOT JUST PASSED INLINE — so a test can call `matchingOperations(spec)` directly
 *   (tag.test.ts does), against an explicit fake `Credentials` layer, without touching
 *   `matchingHandlers`'s baked-in `CredentialsFromEnv` — the same seam `../forgejo/repository.ts`
 *   and `../netbox/prefix.ts` use.
 */
export const spec: MatchingSpec<
  TagProps,
  tags.Tag,
  TagAttributes,
  | tags.CreateTagError
  | tags.GetTagError
  | tags.ListTagsError
  | tags.UpdateTagsPartialError
  | tags.TagsDestroyError
> = {
  attributes: (live, props) => ({
    color: live.color ?? '',
    id: live.id,
    isInboxTag: live.is_inbox_tag === true,
    isInsensitive: live.is_insensitive === true,
    match: live.match ?? '',
    matchingAlgorithm: live.matching_algorithm ?? 0,
    name: live.name,
    owner: live.owner ?? undefined,
    parent: live.parent ?? undefined,
  }),
  create: (body) => tags.createTag(body as unknown as tags.CreateTagRequest),
  describe: (props) => `tags ${props.name}`,
  destroy: (id) => tags.tagsDestroy({ id }),
  endpoint: { create: 'paperless:POST /api/tags/', update: 'paperless:PATCH /api/tags/{id}/' },
  fields: [
    { key: 'color', live: (r) => r.color, prop: (p) => p.color },
    { key: 'match', live: (r) => r.match, prop: (p) => p.match },
    {
      key: 'matching_algorithm',
      live: (r) => r.matching_algorithm,
      prop: (p) => p.matchingAlgorithm,
    },
    { key: 'is_insensitive', live: (r) => r.is_insensitive, prop: (p) => p.isInsensitive },
    { key: 'is_inbox_tag', live: (r) => r.is_inbox_tag, prop: (p) => p.isInboxTag },
    { key: 'parent', live: (r) => r.parent, prop: (p) => p.parent },
  ],
  getById: (id) =>
    tags.getTag({ id }).pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined))),
  list: (props) => tags.listTags({ name__iexact: props.name, page_size: LOCATE_PAGE }),
  ownerOf: (live) => live.owner ?? undefined,
  update: (id, body) =>
    tags.updateTagsPartial({
      ...(body as unknown as Omit<tags.UpdateTagsPartialRequest, 'id'>),
      id,
    }),
};

export const handlers = matchingHandlers(spec);

export const TagProvider = () => Provider.effect(Tag, Effect.succeed(Tag.Provider.of(handlers)));

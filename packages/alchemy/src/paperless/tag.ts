/**
 * `Paperless.Tag` — a Paperless-ngx tag, create-or-update and never deleted by default.
 *
 * ★ `matchingAlgorithm` AND THE OTHER ENUM-SHAPED FIELDS ARE INDEXED OFF THE GENERATED REQUEST
 *   TYPE (`PaperlessTagRequest['matching_algorithm']`), NEVER RETYPED. The literal union `0 | 1 |
 *   … | 6` comes from `codegen/paperless.ts`'s reading of the vendor's own `MatchingAlgorithm`
 *   enum — copying it by hand here would be exactly the guess `schema-provenance` doctrine
 *   forbids, and a vendor that adds a seventh algorithm would leave this type silently stale.
 *
 * ⛔ NO CREDENTIAL IS A PROP. `PAPERLESS_URL`/`PAPERLESS_TOKEN` come from `credentials.ts`.
 * ⛔ `defaultRemovalPolicy: 'retain'` — the reconciler this replaces never deletes taxonomy, and
 *   a tag's id is referenced by every document it is attached to.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import type { PaperlessTagRequest } from './generated/types/tags.ts';
import { type MatchingProps, type MatchingRequirements, matchingHandlers } from './matching.ts';

export interface TagProps extends MatchingProps {
  /** ⚠️ maxLength 128 (generated constraint table). The locate key — see matching.ts's header. */
  name: string;
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

const handlers = matchingHandlers<TagProps, TagAttributes>({
  attributes: (live, props) => {
    const id = live['id'];
    if (typeof id !== 'number') return undefined;
    return {
      color: typeof live['color'] === 'string' ? live['color'] : '',
      id,
      isInboxTag: live['is_inbox_tag'] === true,
      isInsensitive: live['is_insensitive'] === true,
      match: typeof live['match'] === 'string' ? live['match'] : '',
      matchingAlgorithm:
        typeof live['matching_algorithm'] === 'number' ? live['matching_algorithm'] : 0,
      name: typeof live['name'] === 'string' ? live['name'] : props.name,
      owner: typeof live['owner'] === 'number' ? live['owner'] : undefined,
      parent: typeof live['parent'] === 'number' ? live['parent'] : undefined,
    };
  },
  collection: 'tags',
  describe: (props) => `tags ${props.name}`,
  endpoint: { create: 'paperless:POST /api/tags/', update: 'paperless:PATCH /api/tags/{id}/' },
  fields: [
    { key: 'color', live: (r) => r['color'], prop: (p) => p.color },
    { key: 'match', live: (r) => r['match'], prop: (p) => p.match },
    {
      key: 'matching_algorithm',
      live: (r) => r['matching_algorithm'],
      prop: (p) => p.matchingAlgorithm,
    },
    { key: 'is_insensitive', live: (r) => r['is_insensitive'], prop: (p) => p.isInsensitive },
    { key: 'is_inbox_tag', live: (r) => r['is_inbox_tag'], prop: (p) => p.isInboxTag },
    { key: 'parent', live: (r) => r['parent'], prop: (p) => p.parent },
  ],
});

export const TagProvider = () => Provider.effect(Tag, Effect.succeed(Tag.Provider.of(handlers)));

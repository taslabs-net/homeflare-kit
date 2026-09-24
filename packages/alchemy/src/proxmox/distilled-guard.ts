/**
 * Vendor-constraint guards (constraint-guard.ts) for a distilled-backed family — the seam
 * acl.ts's own local `guardWrite` established (acl-wire.ts), generalized once a second family
 * (Group) needed the SAME create/update split `resource.ts`'s `specGuards` (resource-guard.ts)
 * gives every family still on `client.ts`. `codegen/constraints.ts` scans this package's SOURCE
 * TEXT for the endpoint-key strings a caller passes here, so a family switching to this helper
 * changes nothing about which vendor rules apply — same keys, same generated tables.
 *
 * ★ WHY `asForm` IS THE ONLY TRANSLATION NEEDED. Distilled's generated request types for every
 *   PVE form-urlencoded operation are already `Record<string, string | undefined>` — the SAME
 *   shape `PveForm`/`guardForm` want, minus the `?`. There is no JSON vs form-encoding gap to
 *   bridge here the way client.ts's `pve()` had to.
 */
import type * as Effect from 'effect/Effect';
import { guardForm } from './constraint-guard.ts';
import type { EndpointKey } from './constraints.ts';

/**
 * Drops non-string fields — distilled's request type carries `?`, `guardForm` wants a plain
 * form. ⚠️ `body: object`, NOT `Record<string, string | undefined>`: distilled's generated
 * request types are `interface`s with no index signature, so TypeScript refuses that stricter
 * parameter type for every one of them ("index signature ... is missing") even though every
 * field they declare fits it. `object` accepts any of them; the cast below is where the shape
 * is actually asserted, once, rather than at every call site.
 */
export const asForm = (body: object): Record<string, string> =>
  Object.fromEntries(
    Object.entries(body as Record<string, unknown>).filter(
      (e): e is [string, string] => typeof e[1] === 'string',
    ),
  );

/**
 * `presence`: whether a CREATE is really about to happen (required fields are enforced) or the
 * form is only being value-checked in passing — see resource-guard.ts's own header on why this
 * is not "this is the create form" but "a create is really about to happen".
 */
export const guardWrite = (
  endpoint: EndpointKey,
  body: object,
  presence: boolean,
): Effect.Effect<void> => guardForm(endpoint, asForm(body), presence);

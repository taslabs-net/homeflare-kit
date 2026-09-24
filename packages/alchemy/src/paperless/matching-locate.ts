/**
 * The identity-resolution slice of `matching.ts`'s lifecycle, split into its own file so
 * `matching.ts` stays under the house's 250-line-per-file cap. Owns exactly one question — which
 * live Paperless row IS this declaration — by name while there is no state, by the stored
 * `output.id` once there is one. See `matching.ts`'s header for the PR 163 red-team HIGH finding
 * this identity switch fixes.
 *
 * ★ EVERY EXPORT HERE IS GENERIC OVER `R`, NOT TIED TO `PaperlessNgxOpContext` — mirroring
 *   `../netbox/resource.ts`'s standalone `locateOne`. `matching.ts` wires these against a real
 *   spec's `PaperlessNgxOpContext`-typed operations; `matching-locate.test.ts` wires them against
 *   plain `Effect.succeed` fixtures (`R = never`) — the same function, no fake HTTP needed to
 *   prove the pure rule.
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `spec.getById`, NOT HERE —
 *   the direct successor to the old, centralized `absentOn404`, and the same split
 *   `../netbox/resource.ts` and `../forgejo/resource.ts` use. `Effect.catchTag`'s tag-literal
 *   inference needs a concrete error union to resolve `"NotFound"` against; a spec's `E` is only
 *   concrete at each resource file's own call site (`GetTagError`, `GetDocumentTypeError`, …). A
 *   LIST call is never folded here either — an empty `results` page is a normal 200, not a 404
 *   (measured live, kit PR 194).
 */
import * as Effect from 'effect/Effect';

/**
 * ★ Wide enough to see every case-variant candidate `name__iexact` returns; a natural key past it
 *   is not one. Unchanged from the pre-migration `client.ts`'s own value.
 */
export const LOCATE_PAGE = 20;

/**
 * The single row a filtered list returns, or `undefined`.
 *
 * ⛔ MORE THAN ONE MATCH IS A DEFECT, NOT A REASON TO TAKE THE FIRST. If an ambiguous match took
 *   the first row, adopt would bind to it, the next plan would bind to the other, and every plan
 *   after that would report drift that is not there — while "fixing" it PATCHed one object with
 *   the other's declaration. Failing loudly is the only outcome an operator can act on.
 */
export const soleMatch = <T>(rows: readonly T[], describe: string): T | undefined => {
  if (rows.length > 1) {
    throw new Error(
      `${describe} matched ${String(rows.length)} Paperless objects with the same (name, owner).`,
    );
  }
  return rows[0];
};

/**
 * List, then narrow to at most one candidate. Any Paperless resource whose locate is "filter
 * server-side, then disambiguate in this process" reaches this once rather than reimplementing
 * the page-width assertion and the ambiguity defect per resource.
 */
export const locateOne = <Live, E, R>(
  list: Effect.Effect<{ readonly count: number; readonly results: readonly Live[] }, E, R>,
  describe: string,
  identifies?: (row: Live) => boolean,
): Effect.Effect<Live | undefined, E, R> =>
  list.pipe(
    Effect.map((page) => {
      if (page.count > LOCATE_PAGE) {
        throw new Error(
          `${describe}: name__iexact matched ${String(page.count)} rows, more than the ` +
            `${String(LOCATE_PAGE)}-row page this reads. Narrow the name rather than paging.`,
        );
      }
      const rows = identifies === undefined ? page.results : page.results.filter(identifies);
      return soleMatch(rows, describe);
    }),
  );

/**
 * ⛔ THE IDENTITY SWITCH (PR 163, red-team HIGH finding — see `matching.ts`'s header). `output`
 *   defined means this declaration has already written something: identity is `output.id`, full
 *   stop, and a changed `name`/`owner` in the caller's props is drift to PATCH, never a reason to
 *   relocate. `output` undefined means there is nothing to be wrong about yet — locate by name.
 */
export const fetchLive = <Props, Live, Attributes extends { readonly id: number }, E, R>(
  props: Props,
  output: Attributes | undefined,
  fetchByName: (props: Props) => Effect.Effect<Live | undefined, E, R>,
  fetchById: (id: number) => Effect.Effect<Live | undefined, E, R>,
  describe: (props: Props) => string,
): Effect.Effect<Live | undefined, E, R> =>
  output === undefined
    ? fetchByName(props)
    : fetchById(output.id).pipe(
        Effect.flatMap((live) =>
          live === undefined
            ? Effect.die(
                new Error(
                  `${describe(props)}: id ${String(output.id)} is recorded in state but no ` +
                    'longer exists live (deleted out of band). Refusing to create a replacement ' +
                    '— adopt the live object back under this declaration, or remove it from ' +
                    'state, before deploying again.',
                ),
              )
            : Effect.succeed(live),
        ),
      );

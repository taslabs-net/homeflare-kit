/**
 * The identity-resolution slice of `matching.ts`'s lifecycle, split into its own file so
 * `matching.ts` stays under the house's 250-line-per-file cap. Owns exactly one question — which
 * live Paperless row IS this declaration — by name while there is no state, by the stored
 * `output.id` once there is one. See `matching.ts`'s header for the PR 163 red-team HIGH finding
 * this identity switch fixes.
 */
import * as Effect from 'effect/Effect';
import { PaperlessNotFound } from './errors.ts';
import { type PaperlessList, type PaperlessRow, paperless } from './client.ts';
import type { MatchingError, MatchingProps, MatchingRequirements } from './matching-types.ts';

/**
 * ⚠️ Only 404 folds to "absent" — a 401/403 is never read as absent (acceptance criteria).
 * Exported — `matching.ts`'s `destroy` uses it directly around its own DELETE call.
 */
export const absentOn404 = <A>(io: Effect.Effect<A, MatchingError, MatchingRequirements>) =>
  io.pipe(
    Effect.catchIf(
      (cause): cause is PaperlessNotFound => cause instanceof PaperlessNotFound,
      () => Effect.succeed(undefined as A),
    ),
  );

/** ★ Wide enough to see every case-variant candidate `name__iexact` returns; a natural key past it is not one. */
const LOCATE_PAGE = 20;

/** ⚠️ Exported — `matching.ts`'s `patchBody`/`matches` compare the live `owner` too (PR 163). */
export const ownerOf = (row: PaperlessRow): number | undefined =>
  typeof row['owner'] === 'number' ? row['owner'] : undefined;

/**
 * The name/id lookups every `matching.ts` operation shares, built once per family spec.
 * `collection` and `describe` are all this slice needs out of a full `MatchingSpec`.
 */
export const matchingLocate = <Props extends MatchingProps>(spec: {
  readonly collection: string;
  readonly describe: (props: Props) => string;
}) => {
  /**
   * ★ THE NO-STATE LOCATE. Used only when there is no `output` yet: a genuine first create, or
   *   the engine's own adoption probe (`provider.read`, always called with `output: undefined`).
   */
  const fetchByName = (props: Props) =>
    absentOn404(
      paperless<PaperlessList<PaperlessRow>>(
        'GET',
        `${spec.collection}/?name__iexact=${encodeURIComponent(props.name)}&page_size=${String(LOCATE_PAGE)}`,
      ),
    ).pipe(
      Effect.map((list) => {
        if (list !== undefined && list.count > LOCATE_PAGE) {
          throw new Error(
            `${spec.describe(props)}: name__iexact matched ${String(list.count)} rows, more than ` +
              `the ${String(LOCATE_PAGE)}-row page this reads. Narrow the name rather than paging.`,
          );
        }
        const rows = (list?.results ?? []).filter(
          (row) => row['name'] === props.name && ownerOf(row) === (props.owner ?? undefined),
        );
        if (rows.length > 1) {
          throw new Error(
            `${spec.describe(props)}: matched ${String(rows.length)} Paperless objects with the same (name, owner).`,
          );
        }
        return rows[0];
      }),
    );

  /** The stored id itself, once this declaration has one. A 404 here means the row is gone. */
  const fetchById = (id: number) =>
    absentOn404(paperless<PaperlessRow>('GET', `${spec.collection}/${String(id)}/`));

  /**
   * ⛔ THE IDENTITY SWITCH (PR 163, red-team HIGH finding — see `matching.ts`'s header). `output`
   *   defined means this declaration has already written something: identity is `output.id`, full
   *   stop, and a changed `name`/`owner` in `props` is drift to PATCH, never a reason to relocate.
   *   `output` undefined means there is nothing to be wrong about yet — locate by name.
   */
  const fetchLive = <Attributes extends { readonly id: number }>(
    props: Props,
    output: Attributes | undefined,
  ) =>
    output === undefined
      ? fetchByName(props)
      : fetchById(output.id).pipe(
          Effect.flatMap((live) =>
            live === undefined
              ? Effect.die(
                  new Error(
                    `${spec.describe(props)}: id ${String(output.id)} is recorded in state but no ` +
                      'longer exists live (deleted out of band). Refusing to create a replacement ' +
                      '— adopt the live object back under this declaration, or remove it from ' +
                      'state, before deploying again.',
                  ),
                )
              : Effect.succeed(live),
          ),
        );

  const objectPath = (live: PaperlessRow): string => `${spec.collection}/${String(live['id'])}`;

  return { fetchByName, fetchById, fetchLive, objectPath };
};

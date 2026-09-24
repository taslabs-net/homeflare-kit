/**
 * One shape for every Google Workspace Directory object — the same four operations, different
 * distilled call.
 *
 * ⛔ THE ALTERNATIVE IS COPYING THE SAME HANDLERS PER RESOURCE. Groups, group members, domain
 *   aliases and org units are all create / read / update / delete against
 *   `@distilled.cloud/google-workspace`'s typed `admin_directory_v1` operations. Hand-rolling the
 *   fourth copy is where someone drops the read-back or the `isResolved` guard and the plan lies.
 *
 * ★ SO THE FOUR OPERATIONS LIVE HERE, ONCE — mirroring `../forgejo/resource.ts`'s engine exactly.
 *   The Directory API addresses every object this family models by a stable key (an email, a
 *   domain alias name, an org unit path), so — unlike NetBox's page-then-disambiguate `locateOne`
 *   — `fetchLive` is always a plain get-by-key.
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `fetchLive`, NOT HERE — the
 *   same split forgejo's and netbox's engines use. `Effect.catchTag`'s tag-literal inference needs
 *   a concrete error union to resolve `"NotFound"` against; a spec's `E` is only concrete at each
 *   resource file's own call site.
 *
 * ★ ADOPT IS THE DEFAULT POSTURE, NOT A FLAG. `reconcile` LOCATES before it writes: a group or org
 *   unit the Workspace already has is bound, not duplicated — Tim's own domain (schenanigans.com)
 *   predates this code. `spec.attributes` always maps the FULL live object, so a bound row reads
 *   back byte-identical to what Workspace actually holds — the exact-as-live half of `adopt(true)`;
 *   the other half (refusing to bind without it) is upstream's `AdoptPolicy`, unchanged here.
 *
 * ⛔ CREDENTIALS ARE NEVER A PROP (S24/S25). See `credentials.ts` for what a stack passes instead.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { CredentialsFromEnv } from '@distilled.cloud/google-workspace/Credentials';
import type { GoogleWorkspaceOpContext } from '@distilled.cloud/google-workspace/Protocol';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';

/**
 * ★ WHAT EVERY HANDLER NEEDS FROM THE CALLER'S RUNTIME, after Credentials are provided below.
 *   `GoogleWorkspaceOpContext` is `Credentials | HttpClient.HttpClient`; `googleWorkspaceHandlers`
 *   closes over `CredentialsFromEnv` itself (`GOOGLE_ACCESS_TOKEN` / `GOOGLE_PROJECT_ID` — see
 *   credentials.ts), so a consuming stack only has to provide `HttpClient.HttpClient`, the same
 *   shape every other distilled-backed family in this kit asks for.
 */
export type GoogleWorkspaceRequirements = HttpClient.HttpClient;

/**
 * One Directory object's distilled calls. `Live` is whatever the SDK decodes (a `Group`, a
 * `Member`, a `DomainAlias`, an `OrgUnit`) — never an untyped response body.
 *
 * `E` is left to each resource file to declare (the union of the distilled operations it
 * actually calls), so a call site's precise per-operation error union flows straight through
 * instead of being widened by hand here.
 */
export type GoogleWorkspaceSpec<Props extends object, Live, Attributes, E> = {
  /** Already folds a real "absent" outcome — a `catchTag('NotFound', ...)` at the call site. */
  readonly fetchLive: (
    props: Props,
  ) => Effect.Effect<Live | undefined, E, GoogleWorkspaceOpContext>;
  readonly attributes: (live: Live, props: Props) => Attributes | undefined;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /** Absent for an existence-only family (none here yet, but `GroupMember` could become one). */
  readonly create?: (props: Props) => Effect.Effect<unknown, E, GoogleWorkspaceOpContext>;
  readonly update?: (
    props: Props,
    live: Live,
  ) => Effect.Effect<unknown, E, GoogleWorkspaceOpContext>;
  readonly destroy: (
    props: Props,
    live: Live,
  ) => Effect.Effect<unknown, E, GoogleWorkspaceOpContext>;
  /** For the read-back-failure message. */
  readonly describe: (props: Props) => string;
};

export const googleWorkspaceOperations = <Props extends object, Live, Attributes, E>(
  spec: GoogleWorkspaceSpec<Props, Live, Attributes, E>,
) => {
  const read = (props: Props) =>
    spec
      .fetchLive(props)
      .pipe(Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))));

  return {
    read,

    diff: (news: Input<Props>, output: Attributes | undefined) =>
      Effect.gen(function* () {
        if (output === undefined || !isResolved(news)) return undefined;
        const live = yield* read(news);
        if (live === undefined) return { action: 'update' } as const;
        if (spec.matches(live, news)) return { action: 'noop' } as const;
        return spec.update === undefined
          ? ({ action: 'replace' } as const)
          : ({ action: 'update' } as const);
      }),

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const before = yield* spec.fetchLive(news);
        if (before === undefined) {
          if (spec.create === undefined) {
            return yield* Effect.die(
              new Error(`${spec.describe(news)}: spec declares no create for a missing object`),
            );
          }
          yield* spec.create(news);
        } else if (spec.update !== undefined) {
          const mapped = spec.attributes(before, news);
          // ⚠️ ADOPTION IS THE `mapped === undefined` CASE TOO: a row this spec cannot map is not
          //   a row to PATCH blindly.
          if (mapped !== undefined && !spec.matches(mapped, news)) {
            yield* spec.update(news, before);
          }
        }
        const after = yield* read(news);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              `${spec.describe(news)}: the write returned no error but the object is still ` +
                'absent. Directory returns the object it wrote — read back rather than trusting ' +
                'the status code.',
            ),
          );
        }
        return after;
      }),

    destroy: (olds: Props) =>
      Effect.gen(function* () {
        const live = yield* spec.fetchLive(olds);
        if (live === undefined) return;
        yield* spec.destroy(olds, live);
      }),
  };
};

/**
 * The five provider handlers for a spec'd Directory object, wired once.
 *
 * ★ CREDENTIALS ARE PROVIDED HERE, ONCE, NOT BY EVERY CALLER. `CredentialsFromEnv` resolves
 *   `GOOGLE_ACCESS_TOKEN` on the calling fiber per request (credentials.ts's own note), so this
 *   closure keeps that laziness — nothing is captured at module load.
 *
 * ⛔ IT STOPS AT THE HANDLERS AND DOES NOT RETURN THE LAYER — same reasoning as `forgejoHandlers`.
 *
 * ⚠️ `list` answers empty. The Directory API's list endpoints page the whole domain — every group,
 *   every org unit — so adoption stays explicit rather than sweeping (same posture as NetBox and
 *   Forgejo; the census handoff script, not this provider, is where a full inventory belongs).
 */
export const googleWorkspaceHandlers = <Props extends object, Live, Attributes extends object, E>(
  spec: GoogleWorkspaceSpec<Props, Live, Attributes, E>,
) => {
  const ops = googleWorkspaceOperations(spec);
  const withCredentials = <A>(effect: Effect.Effect<A, E, GoogleWorkspaceOpContext>) =>
    Effect.provide(effect, CredentialsFromEnv);
  return {
    list: () => Effect.succeed([]),
    read: ({ olds }: { olds: Props }) => withCredentials(ops.read(olds)),
    diff: ({ news, output }: { news: Input<Props>; output: Attributes | undefined }) =>
      withCredentials(ops.diff(news, output)),
    reconcile: ({ news }: { news: Props }) => withCredentials(ops.reconcile(news)),
    delete: ({ olds }: { olds: Props }) => withCredentials(ops.destroy(olds)),
  };
};

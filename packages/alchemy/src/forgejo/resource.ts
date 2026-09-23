/**
 * One shape for every Forgejo object — the same four operations, different distilled call.
 *
 * ⛔ THE ALTERNATIVE IS COPYING THE SAME HANDLERS PER RESOURCE. Repositories, org labels, teams,
 *   webhooks, branch protection and org secrets are all create / read / update / delete against
 *   `@distilled.cloud/forgejo`'s typed operations. Hand-rolling the fourth copy is where someone
 *   drops the read-back or the isResolved guard and the plan lies.
 *
 * ★ SO THE FOUR OPERATIONS LIVE HERE, ONCE. A new Forgejo object is a spec (which distilled
 *   operations to call) plus attribute mapping, not a hundred and thirty lines of its own.
 *
 * 🔴 WHY THIS REPLACED `client.ts`'s HAND-ROLLED `HttpClient` CALLS. Measured against Tim's
 *   distilled research page 2026-09-23: upstream Alchemy only accepts providers that call
 *   `@distilled.cloud/<vendor>` operations and `catchTag` their typed errors — not a raw
 *   `fetch`/`HttpClient` client over a hand-maintained path table. `@distilled.cloud/forgejo`
 *   published at 1.0.0-rc.12 covers every operation this family calls (verified operation by
 *   operation while porting each resource file).
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `fetchLive`, NOT HERE — the
 *   direct successor to the old, centralized `absentOn404`. `Effect.catchTag`'s tag-literal
 *   inference needs a concrete error union to resolve `"NotFound"` against; a spec's `E` is only
 *   concrete at each resource file's own call site (`RepoGetBranchProtectionError`, `GetRepoError`,
 *   …), not inside this shared engine's generic functions. So every `fetchLive` below ends
 *   `.pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined)))` itself — one line,
 *   `catchTag`, never a status comparison — and this engine trusts the result is already folded.
 *
 * ⚠️ GITEA ANSWERS WITH THE OBJECT DIRECTLY — NOT `{"data": ...}`, and the distilled SDK decodes
 *   that shape already. `reconcile` still READS BACK after every write rather than trusting a
 *   write response alone — a create/update can 200 with a body this family does not fully trust
 *   until the follow-up `read`.
 *
 * ★ WHY `Forgejo.Repository` DECLARES `defaultRemovalPolicy: 'retain'`, WRITTEN ONCE HERE.
 *   Alchemy's own `GitHub.Repository` defaults to retain "because their contents are
 *   irreplaceable". A git repository is the most irreplaceable object on this estate. `retain`
 *   means the engine skips `provider.delete` when a resource is orphaned unless the caller opted
 *   into `.pipe(RemovalPolicy.destroy())`. The `delete` handler is FULLY IMPLEMENTED anyway — a
 *   stub that silently does nothing lies to whoever reads the plan.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { CredentialsFromEnv } from '@distilled.cloud/forgejo/Credentials';
import type { ForgejoOpContext } from '@distilled.cloud/forgejo/Protocol';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';

/**
 * ★ WHAT EVERY HANDLER NEEDS FROM THE CALLER'S RUNTIME, after Credentials are provided below.
 *   `Forgejo.ForgejoOpContext` is `Credentials | HttpClient.HttpClient`; `forgejoHandlers` closes
 *   over `CredentialsFromEnv` itself (same `FORGEJO_URL` / `FORGEJO_TOKEN` names client.ts read,
 *   still resolved at call time — see credentials.ts's own note on that), so a consuming stack
 *   only has to provide `HttpClient.HttpClient`, exactly as it did before this migration.
 */
export type ForgejoRequirements = HttpClient.HttpClient;

/**
 * One Forgejo object's distilled calls. `Live` is whatever the SDK decodes (a `Repository`, a
 * `Label`, a composite for team membership, …) — no more untyped `Record<string, unknown>`.
 *
 * `E` is left to each resource file to declare (the union of the distilled operations' error
 * types it actually calls, e.g. `RepoCreateHookError | RepoEditHookError | ...`), so a call site's
 * precise per-operation error union flows straight through instead of being widened by hand here.
 */
export type ForgejoSpec<Props extends object, Live, Attributes, E> = {
  /** Already folds the SDK's `NotFound` to `undefined` via its own `catchTag` — see the note above. */
  readonly fetchLive: (props: Props) => Effect.Effect<Live | undefined, E, ForgejoOpContext>;
  readonly attributes: (live: Live, props: Props) => Attributes | undefined;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /** Absent for the two existence-only families (`OrgSecret`, `TeamMember`), which use `upsert` instead. */
  readonly create?: (props: Props) => Effect.Effect<unknown, E, ForgejoOpContext>;
  readonly update?: (props: Props, live: Live) => Effect.Effect<unknown, E, ForgejoOpContext>;
  /**
   * When create is PUT upsert rather than POST — org actions secrets have no POST and no GET-by-name.
   * `before === undefined` means absent; the callback decides whether to write. Existence-only families
   * noop when `before` is set because the API never returns the value for comparison.
   */
  readonly upsert?: (
    props: Props,
    before: Live | undefined,
  ) => Effect.Effect<void, E, ForgejoOpContext>;
  readonly destroy: (props: Props, live: Live) => Effect.Effect<unknown, E, ForgejoOpContext>;
};

export const forgejoOperations = <Props extends object, Live, Attributes, E>(
  spec: ForgejoSpec<Props, Live, Attributes, E>,
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
        if (spec.upsert !== undefined) {
          yield* spec.upsert(news, before);
        } else if (before === undefined) {
          if (spec.create === undefined) {
            return yield* Effect.die(
              new Error('forgejoOperations: spec declares neither create nor upsert'),
            );
          }
          yield* spec.create(news);
        } else if (spec.update !== undefined) {
          const mapped = spec.attributes(before, news);
          if (mapped === undefined || spec.matches(mapped, news)) {
            /* adoption or already converged — no PATCH */
          } else {
            yield* spec.update(news, before);
          }
        }
        const after = yield* read(news);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              'the write returned no error but the object is still absent. ' +
                'Gitea returns the object directly — read back rather than trusting the status code.',
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
 * The five provider handlers for a spec'd Forgejo object, wired once.
 *
 * ★ CREDENTIALS ARE PROVIDED HERE, ONCE, NOT BY EVERY CALLER. `CredentialsFromEnv` resolves
 *   `FORGEJO_URL` / `FORGEJO_TOKEN` on the calling fiber per request (credentials.ts's own note),
 *   so this closure keeps that laziness — nothing is captured at module load.
 *
 * ⛔ IT STOPS AT THE HANDLERS AND DOES NOT RETURN THE LAYER — same reasoning as pveHandlers in
 *   <estate>/proxmox: wrapping `Provider.effect` here needs casts against Alchemy's `Props<R>`.
 *
 * ⚠️ `list` answers empty — Forgejo index endpoints return the whole org; adoption stays explicit.
 */
export const forgejoHandlers = <Props extends object, Live, Attributes extends object, E>(
  spec: ForgejoSpec<Props, Live, Attributes, E>,
) => {
  const ops = forgejoOperations(spec);
  const withCredentials = <A>(effect: Effect.Effect<A, E, ForgejoOpContext>) =>
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

/**
 * One shape for every Argo CD REST object — Repository, RepoCreds, Cluster — the same four
 * operations, different distilled call.
 *
 * ⛔ THIS IS A NEAR-VERBATIM COPY OF `../forgejo/resource.ts`'S ENGINE, ON PURPOSE. Both SDKs speak
 *   plain bearer-authenticated REST with a real `NotFound` tag (see the family's own docs.md for
 *   why Argo CD, UNLIKE Discord, gets a genuine typed 404 — measured from `protocol.ts`), so the
 *   same read/diff/reconcile/destroy shape applies unchanged. A second hand-rolled engine here
 *   would just be forgejo's with the names swapped.
 *
 * ⚠️ NO `Unowned`/`adopt(true)` WRAPPING HERE — mirrors forgejo's own choice (not netbox's or
 *   discord's `Unowned` marker), not an oversight. A live match on a cold read (no persisted
 *   `output`) is treated as ours, same as every other forgejo-shaped family in this kit today.
 *
 * ⚠️ `NotFound` IS FOLDED TO "ABSENT" INSIDE EACH RESOURCE FILE'S OWN `fetchLive`, NOT HERE.
 *   `Effect.catchTag`'s tag-literal inference needs a concrete error union to resolve `"NotFound"`
 *   against; a spec's `E` is only concrete at each resource file's own call site. So every
 *   `fetchLive` ends `.pipe(Effect.catchTag('NotFound', () => Effect.succeed(undefined)))` itself.
 */
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import { CredentialsFromEnv } from '@distilled.cloud/argocd/Credentials';
import type { ArgocdOpContext } from '@distilled.cloud/argocd/Protocol';
import * as Effect from 'effect/Effect';
import type * as HttpClient from 'effect/unstable/http/HttpClient';

/** What every handler needs from the caller's runtime, once `argocdHandlers` bakes in credentials. */
export type ArgocdRequirements = HttpClient.HttpClient;

/**
 * Strips undefined-valued keys, mapping each to a genuinely optional key rather than a present
 * key typed `X | undefined`. `tsconfig.base.json` turns on `exactOptionalPropertyTypes`, and every
 * generated Argo CD request type declares its optional fields the strict way (`foo?: X`, never
 * `foo?: X | undefined`) — so `{ foo: props.foo }` where `props.foo?: X` does not typecheck against
 * it even when `foo` is genuinely absent at runtime. Every resource file's request body goes
 * through this once, mirroring `forgejo/repository.ts#editForm`'s conditional-spread idiom, just
 * generalized instead of repeated per field.
 */
export const present = <T extends object>(obj: T): { [K in keyof T]?: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as never;

/**
 * One Argo CD object's distilled calls. `Live` is whatever the SDK decodes (`V1alpha1Repository`,
 * `V1alpha1Cluster`, …); `E` is left to each resource file to declare.
 */
export type ArgocdSpec<Props extends object, Live, Attributes, E> = {
  /**
   * The identity key's value — `repo`/`url`/`server` depending on the resource — read off
   * declared props and off persisted attributes respectively. `diff` compares the two to detect
   * an identity change, which `upsert`'s single create-or-converge call cannot express as an
   * in-place update: Argo CD indexes each of these objects BY this value, so a changed identity
   * means a create at the new key, never a rename, and the object left at the old key must be
   * deleted — exactly what a `replace` diff action tells Alchemy's own Plan/Apply to do (delete
   * the old physical object, using `olds`, then reconcile `news`). Without this, a changed
   * `repo`/`url`/`server` orphans the old, still-credentialed object with no state pointing at it
   * — found in adversarial review 2026-09-24, fixed here.
   */
  readonly identityOfProps: (props: Props) => string;
  readonly identityOfAttributes: (attributes: Attributes) => string;
  /** Already folds the SDK's `NotFound` to `undefined` via its own `catchTag` — see the note above. */
  readonly fetchLive: (props: Props) => Effect.Effect<Live | undefined, E, ArgocdOpContext>;
  readonly attributes: (live: Live, props: Props) => Attributes | undefined;
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /**
   * A single upsert call — every Argo CD create endpoint this family uses takes `upsert: true`
   * and converges create-or-update in one request, so there is no separate update path to wire.
   */
  readonly upsert: (props: Props) => Effect.Effect<unknown, E, ArgocdOpContext>;
  readonly destroy: (props: Props, live: Live) => Effect.Effect<unknown, E, ArgocdOpContext>;
};

export const argocdOperations = <Props extends object, Live, Attributes, E>(
  spec: ArgocdSpec<Props, Live, Attributes, E>,
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
        // The identity key changed (repo/url/server) — `upsert` cannot rename in place, it would
        // create at the new key and leave the old, still-live object orphaned. See the spec type.
        if (spec.identityOfProps(news) !== spec.identityOfAttributes(output)) {
          return { action: 'replace' } as const;
        }
        const live = yield* read(news);
        if (live === undefined) return { action: 'update' } as const;
        return spec.matches(live, news)
          ? ({ action: 'noop' } as const)
          : ({ action: 'update' } as const);
      }),

    reconcile: (news: Props) =>
      Effect.gen(function* () {
        const before = yield* read(news);
        // S10: no write when what's declared already matches what's live.
        if (before === undefined || !spec.matches(before, news)) {
          yield* spec.upsert(news);
        }
        const after = yield* read(news);
        if (after === undefined) {
          return yield* Effect.die(
            new Error(
              'the write returned no error but the object is still absent — read back rather ' +
                'than trust the status code.',
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
 * The four provider handlers for a spec'd Argo CD object, wired once.
 *
 * ★ CREDENTIALS ARE PROVIDED HERE, ONCE. `CredentialsFromEnv` resolves `ARGOCD_TOKEN` /
 *   `ARGOCD_SERVER` on the calling fiber per request (credentials.ts), never captured at load.
 *
 * ⚠️ `list` answers empty — Argo CD's list endpoints return every object of that kind on the whole
 *   instance; adoption stays explicit (a declared resource's own `read`), same reasoning as
 *   forgejo and discord.
 */
export const argocdHandlers = <Props extends object, Live, Attributes extends object, E>(
  spec: ArgocdSpec<Props, Live, Attributes, E>,
) => {
  const ops = argocdOperations(spec);
  const withCredentials = <A>(effect: Effect.Effect<A, E, ArgocdOpContext>) =>
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

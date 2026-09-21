/**
 * The providers a stack registered, wrapped so the plan can be watched and can never write.
 *
 * ★ WHY A WRAPPER AND NOT A LOG LINE. alchemy beta.79 Plan.ts loses the provider's answer on the one
 *   path that matters: after the cold-start adoption probe it sets `forceUpdateAfterAdoption` and
 *   maps a `noop` diff to `update`, and the node says `adopted` either way. Nothing is logged, and
 *   `alchemy plan` has no JSON output — `describePlan` carries only the forced action. The engine
 *   resolves every provider from the Effect context by resource type (Provider.ts
 *   `tryFindProviderRegistrationByType`), so the one honest place to hear the raw answer is the
 *   provider service itself. This hands Alchemy's own `Plan.make` a context whose providers record
 *   what `read` and `diff` answered, per FQN, and otherwise behave exactly as registered.
 *
 * ⛔ EVERY WRITE PATH DIES. `reconcile`, `delete` and `precreate` are replaced, not wrapped: the
 *   planner never calls them, and a verifier that could reach one by accident is worse than none.
 *   `read`, `diff`, `list`, `tail` and `logs` pass through — each is a read by Alchemy's contract.
 *
 * ⚠️ A MISSING `diff` IS WRAPPED AS ONE ANSWERING `undefined`, which is exactly what the planner
 *   does without one (`provider?.diff?.(…)` then its own props compare), so behaviour is unchanged
 *   and the report can say `none` instead of guessing. A missing `read` stays missing: adding one
 *   would make the planner probe where it otherwise would not.
 */
import { Unowned, stripUnowned } from 'alchemy/AdoptPolicy';
import {
  type ProviderCollectionService,
  type ProviderService,
  isProviderCollectionService,
  isProviderService,
} from 'alchemy/Provider';
import * as Context from 'effect/Context';
import * as Effect from 'effect/Effect';

export type ReadAnswer = 'found' | 'unowned' | 'absent' | 'failed' | 'not-read';
export type DiffAnswer = 'noop' | 'update' | 'replace' | 'none' | 'not-run';

/** What one FQN's provider answered during the plan — the LAST answer of each kind. */
export interface Seen {
  read?: { readonly answer: ReadAnswer; readonly attributes: unknown };
  diff?: { readonly answer: DiffAnswer; readonly news: unknown };
}

/** Keyed by FQN. Filled while the plan runs; read once it is done. */
export type Observations = Map<string, Seen>;

const seenFor = (seen: Observations, fqn: string): Seen => {
  const existing = seen.get(fqn);
  if (existing !== undefined) return existing;
  const fresh: Seen = {};
  seen.set(fqn, fresh);
  return fresh;
};

/** The refusal every write path answers with. Exported so a test can match it. */
export const WRITE_REFUSED = 'hf-adopt-verify never writes';

const refuse = (type: string, operation: string) => () =>
  Effect.die(
    new Error(
      `${WRITE_REFUSED}: ${type}.${operation} was called during a verification. Alchemy's planner ` +
        'does not call it, so something other than Plan.make is driving these providers.',
    ),
  );

const readAnswer = (attributes: unknown): ReadAnswer =>
  attributes === undefined ? 'absent' : Unowned.is(attributes) ? 'unowned' : 'found';

const diffAnswer = (diff: unknown): DiffAnswer => {
  const action = (diff as { action?: unknown } | undefined)?.action;
  return action === 'noop' || action === 'update' || action === 'replace' ? action : 'none';
};

/**
 * One provider service, watched. ⚠️ The spread keeps `version`, `aliases`, `mode`, `stables`,
 * `list` and the rest exactly as registered — the planner reads several of them.
 */
export const spyService = (type: string, service: ProviderService, seen: Observations) => {
  const read = service.read;
  const diff = service.diff;
  const modes = service.modes;
  const watched: ProviderService = {
    ...service,
    diff: (input) =>
      (diff === undefined ? Effect.succeed(undefined) : diff(input)).pipe(
        Effect.tap((answer) =>
          Effect.sync(() => {
            seenFor(seen, input.fqn).diff = { answer: diffAnswer(answer), news: input.news };
          }),
        ),
      ),
    reconcile: refuse(type, 'reconcile'),
    delete: refuse(type, 'delete'),
  };
  if (read !== undefined) {
    watched.read = (input) =>
      read(input).pipe(
        Effect.tap((answer) =>
          Effect.sync(() => {
            const attributes = answer === undefined ? undefined : stripUnowned(answer);
            seenFor(seen, input.fqn).read = { answer: readAnswer(answer), attributes };
          }),
        ),
      );
  }
  if (service.precreate !== undefined) watched.precreate = refuse(type, 'precreate');
  // ⚠️ A `ProviderLayer.dual` registration resolves a per-mode variant at plan time
  //   (Provider.ts `providerForMode`); wrapping only the registration would miss it.
  if (modes !== undefined) {
    watched.modes = {
      live: Effect.map(modes.live, (variant) => spyService(type, variant, seen)),
      local: Effect.map(modes.local, (variant) => spyService(type, variant, seen)),
    };
  }
  return watched;
};

const spyCollection = (
  collection: ProviderCollectionService,
  seen: Observations,
): ProviderCollectionService => {
  const providers = Object.fromEntries(
    Object.entries(collection.providers).map(([type, service]) => [
      type,
      spyService(type, service, seen),
    ]),
  );
  return { ...collection, get: (type: string) => providers[type] as never, providers };
};

/**
 * The same context with every provider service — direct or inside a `Provider.collection` —
 * replaced by its watched copy. Everything else (the state store, the stack, credentials) is the
 * very object the session built.
 */
export const spyContext = <R>(
  context: Context.Context<R>,
  seen: Observations,
): Context.Context<R> => {
  const services = new Map<string, unknown>();
  for (const [key, value] of context.mapUnsafe) {
    services.set(
      key,
      isProviderService(value)
        ? spyService(key, value, seen)
        : isProviderCollectionService(value)
          ? spyCollection(value, seen)
          : value,
    );
  }
  return Context.makeUnsafe<R>(services);
};

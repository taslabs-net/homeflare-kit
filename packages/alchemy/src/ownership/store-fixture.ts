/**
 * A state store and a Stack for the ownership/ unit tests — the two services rows.ts reads.
 *
 * ⛔ TEST-ONLY. No provider imports this file and it is not on any barrel.
 */
import { InMemoryService } from 'alchemy/State/InMemoryState';
import type { ResourceState } from 'alchemy/State/ResourceState';
import { State } from 'alchemy/State/State';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';

/** A row with no attributes: `creating`, or `replacing` when it carries an `old` generation. */
export const row = (
  fqn: string,
  instanceId: string,
  old?: unknown,
  props: unknown = { name: 'a' },
): ResourceState =>
  ({
    fqn,
    instanceId,
    old,
    props,
    status: old === undefined ? 'creating' : 'replacing',
  }) as unknown as ResourceState;

/**
 * A stack `s` at stage `test` whose store holds `rows`: `A` and `B` declared with a `name`, and `Z`
 * declared `renamedFrom('X')`.
 */
export const withStore = <A>(
  rows: Record<string, ResourceState>,
  effect: Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(State, InMemoryService({ s: { test: rows } })),
      Effect.provideService(Stack, {
        actions: {},
        bindings: {},
        name: 's',
        resources: {
          A: { Props: { name: 'a' } },
          B: { Props: { name: 'b' } },
          Z: { FormerFqns: ['X'], Props: { name: 'a' } },
        },
        stage: 'test',
      } as never),
    ),
  );

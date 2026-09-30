/**
 * Which live row a `LiteLLM.Model` declaration means, and which id a new row would ask for.
 *
 * ★ THE LIST DECIDES FIRST. `GET /model/info` answers every deployment row in one call, so a
 *   group name, an id and absence are all decided from it (model-operations.ts). The by-id read
 *   is the same route with the `litellm_model_id` filter, kept only for the write-back on a row
 *   the list may not show yet — after a create, the read-back falls back to it exactly like
 *   `mcp-server-locate.ts` does for the registry.
 * ⚠️ ADOPT-BY-NAME NEEDS THE LIST: a name cannot be read from the table by this route family. A
 *   row the list lacks is adoptable only by declaring its `id`.
 * ⛔ A NAME IS NOT UNIQUE (unlike an MCPServer): LiteLLM runs several deployments under one group
 *   name on purpose, so a name that matches more than one listed row is refused
 *   (`LitellmModelAmbiguousNameError`), never guessed at.
 */
import { createPhysicalName } from 'alchemy/PhysicalName';
import * as Effect from 'effect/Effect';
import { LitellmModelAmbiguousNameError } from './model-errors.ts';
import { listModels, readModelRow } from './model-operations.ts';
import type { ModelAttributes, ModelProps } from './model-types.ts';

/**
 * The live row among the LISTED ones, or `undefined`. A pinned id (from state, else declared) wins;
 * otherwise the name decides, and an ambiguous name is refused.
 */
export const locate = (
  rows: readonly ModelAttributes[],
  props: ModelProps,
  output: ModelAttributes | undefined,
) => {
  const pinned = output?.id ?? props.id;
  if (pinned !== undefined) return Effect.succeed(rows.find((row) => row.id === pinned));
  const named = rows.filter((row) => row.modelName === props.modelName);
  return named.length > 1
    ? Effect.fail(
        new LitellmModelAmbiguousNameError({
          ids: named.map((row) => row.id),
          modelName: props.modelName,
        }),
      )
    : Effect.succeed(named[0]);
};

/** The id a create asks for: the recorded one, else the declared one, else a deterministic name. */
export const wantedId = (
  id: string,
  instanceId: string,
  props: ModelProps,
  output: ModelAttributes | undefined,
) =>
  output?.id !== undefined
    ? Effect.succeed(output.id)
    : props.id !== undefined
      ? Effect.succeed(props.id)
      : createPhysicalName({ id, instanceId, lowercase: true, maxLength: 64 });

/** The live row this declaration means, from the list, else from the table by the id it would use. */
export const findLive = (
  id: string,
  instanceId: string,
  props: ModelProps,
  output: ModelAttributes | undefined,
) =>
  Effect.gen(function* () {
    const listed = yield* locate(yield* listModels(), props, output);
    if (listed !== undefined) return listed;
    return yield* readModelRow(yield* wantedId(id, instanceId, props, output));
  });

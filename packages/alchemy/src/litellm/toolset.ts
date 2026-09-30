/**
 * `LiteLLM.Toolset` — one row of LiteLLM's MCP toolset table (`/v1/mcp/toolset`): a named selection of
 * `{ server_id, tool_name }` pairs a key or team can be granted instead of whole servers. Props and
 * what is left out: toolset-types.ts.
 *
 * ★ ADOPT BY NAME. `toolset_name` is unique, so `toolsetName` finds the one live row (from the LIST,
 *   which is the only by-name lookup the API has, and which cannot prove absence: toolset-operations.ts).
 *   A live row with no state is `Unowned`, so it needs `--adopt`.
 * ★ THE ID IS THE PROXY'S and is what state remembers; every later read is BY ID, from the table.
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a toolset does not detach it: teams and keys that hold
 *   its id keep a dangling grant, and every caller reaching MCP through it loses the tools.
 * ⚠️ NO LICENCE GATE ON THESE ROUTES: `mcp_management_endpoints.py`'s toolset block has no
 *   `premium_user` check (1.103.0), and docs.litellm.ai/docs/mcp_toolsets makes no Enterprise statement.
 *   Writes need PROXY_ADMIN (403 otherwise).
 * ⛔ NO LITELLM CREDENTIAL IS A PROP; `litellmProviders`' layer supplies `Credentials`.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import {
  LitellmRegistryAbsentAfterWriteError,
  LitellmRegistryAmbiguousError,
  LitellmRegistryNotConvergedError,
  LitellmRegistryUnreadableError,
} from './registry-errors.ts';
import { dieIfInvalid, failIfInvalid } from './registry-support.ts';
import { createBody, differing, firstProblem, updateBody } from './toolset-form.ts';
import {
  createToolset,
  deleteToolset,
  listToolsets,
  readToolset,
  updateToolset,
} from './toolset-operations.ts';
import type { ToolsetAttributes, ToolsetProps } from './toolset-types.ts';

export type { ToolsetAttributes, ToolsetProps };
export type { RegistryError as ToolsetError } from './registry-errors.ts';

const RESOURCE = 'LiteLLM.Toolset';

export interface LiteLLMToolset extends Resource<
  'LiteLLM.Toolset',
  ToolsetProps,
  ToolsetAttributes
> {}

export const LiteLLMToolset = Resource<LiteLLMToolset>('LiteLLM.Toolset', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMToolset = (value: unknown): value is LiteLLMToolset =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.Toolset';

/**
 * The live row this declaration means: BY ID from the table when state has one (a vanished row is
 * `undefined`, never taken over by name), else by name from the list. Two rows sharing a name would
 * mean the unique index is gone; refused, never guessed.
 */
const locate = (props: ToolsetProps, output: ToolsetAttributes | undefined) =>
  Effect.gen(function* () {
    if (output !== undefined) return yield* readToolset(output.toolsetId);
    const named = (yield* listToolsets()).filter((row) => row.toolsetName === props.toolsetName);
    if (named.length > 1) {
      return yield* Effect.fail(
        new LitellmRegistryAmbiguousError({
          ids: named.map((row) => row.toolsetId),
          name: props.toolsetName,
          resource: RESOURCE,
        }),
      );
    }
    return named[0];
  });

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const toolsetHandlers = {
  /** ⛔ With no `output` this is the adoption probe, so the refusals run here too (registry-support.ts). */
  read: ({ olds, output }: { olds: ToolsetProps; output: ToolsetAttributes | undefined }) =>
    Effect.gen(function* () {
      if (output === undefined) {
        yield* dieIfInvalid(RESOURCE, String(olds.toolsetName), firstProblem(olds));
      }
      const live = yield* locate(olds, output);
      if (live === undefined) return undefined;
      return output === undefined ? Unowned(live) : live;
    }),

  diff: ({ news, output }: { news: Input<ToolsetProps>; output: ToolsetAttributes | undefined }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* failIfInvalid(RESOURCE, String(news.toolsetName), firstProblem(news));
      if (output === undefined) return undefined;
      return differing(output, news).length === 0
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ news, output }: { news: ToolsetProps; output: ToolsetAttributes | undefined }) =>
    Effect.gen(function* () {
      yield* failIfInvalid(RESOURCE, String(news.toolsetName), firstProblem(news));
      const before = yield* locate(news, output);
      let toolsetId: string;
      if (before === undefined) {
        const created = yield* createToolset(createBody(news));
        if (created === undefined) {
          return yield* Effect.fail(
            new LitellmRegistryUnreadableError({
              reason: 'the create answered something that is not a toolset',
              resource: RESOURCE,
            }),
          );
        }
        toolsetId = created.toolsetId;
      } else {
        toolsetId = before.toolsetId;
        if (differing(before, news).length > 0) yield* updateToolset(updateBody(news, before));
      }

      // ★ BY ID FROM THE TABLE, never the list: the list is the caller-narrowed, error-swallowing view.
      const after = yield* readToolset(toolsetId);
      if (after === undefined) {
        return yield* Effect.fail(
          new LitellmRegistryAbsentAfterWriteError({ name: news.toolsetName, resource: RESOURCE }),
        );
      }
      const left = differing(after, news);
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmRegistryNotConvergedError({
            fields: left,
            name: news.toolsetName,
            resource: RESOURCE,
          }),
        );
      }
      return after;
    }),

  delete: ({ output }: { output: ToolsetAttributes }) => deleteToolset(output.toolsetId),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by. */
  list: () => Effect.succeed([]),
};

export const LiteLLMToolsetProvider = () =>
  Provider.effect(LiteLLMToolset, Effect.succeed(LiteLLMToolset.Provider.of(toolsetHandlers)));

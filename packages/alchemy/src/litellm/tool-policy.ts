/**
 * `LiteLLM.ToolPolicy` — the input and output trust policy of one tool in LiteLLM's tool registry
 * (`LiteLLM_ToolTable`, `POST /v1/tool/policy`). Props, the enforcement precondition and what is left
 * out: tool-policy-types.ts.
 *
 * ⛔ INERT WITHOUT THE `tool_policy` GUARDRAIL in the proxy's own config (tool-policy-types.ts).
 * ★ ADOPT BY NAME. LiteLLM discovers tools itself, so a tool it has already seen has a live row with no
 *   state: `Unowned`, which needs `--adopt` (a row at the defaults is adopted the same way). A tool
 *   never seen has no row, and the write creates it.
 * ★ `defaultRemovalPolicy: 'retain'` — there is no delete route. `delete` RESETS the managed fields to
 *   `untrusted` (tool-policy-operations.ts), which for an `input_policy` of `blocked` re-opens a tool.
 *   Opt in with `.pipe(RemovalPolicy.destroy())`.
 * ⚠️ NO LICENCE GATE ON THESE ROUTES: `tool_management_endpoints.py` has no `premium_user` check
 *   (1.103.0). Whether the `tool_policy` guardrail itself is licence-gated is UNVERIFIED (its module
 *   has no `premium` reference either).
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
  LitellmRegistryNotConvergedError,
} from './registry-errors.ts';
import { dieIfInvalid, failIfInvalid } from './registry-support.ts';
import { differing, firstProblem, updateBody } from './tool-policy-form.ts';
import { readTool, resetToolPolicy, writeToolPolicy } from './tool-policy-operations.ts';
import type { ToolPolicyAttributes, ToolPolicyProps } from './tool-policy-types.ts';

export type { ToolPolicyAttributes, ToolPolicyProps };
export type { ToolInputPolicy, ToolOutputPolicy } from './tool-policy-types.ts';
export type { RegistryError as ToolPolicyError } from './registry-errors.ts';

const RESOURCE = 'LiteLLM.ToolPolicy';

export interface LiteLLMToolPolicy extends Resource<
  'LiteLLM.ToolPolicy',
  ToolPolicyProps,
  ToolPolicyAttributes
> {}

export const LiteLLMToolPolicy = Resource<LiteLLMToolPolicy>('LiteLLM.ToolPolicy', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMToolPolicy = (value: unknown): value is LiteLLMToolPolicy =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.ToolPolicy';

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const toolPolicyHandlers = {
  /** ⛔ With no `output` this is the adoption probe, so the refusals run here too (registry-support.ts). */
  read: ({ olds, output }: { olds: ToolPolicyProps; output: ToolPolicyAttributes | undefined }) =>
    Effect.gen(function* () {
      if (output === undefined) {
        yield* dieIfInvalid(RESOURCE, String(olds.toolName), firstProblem(olds));
      }
      const live = yield* readTool(output?.toolName ?? olds.toolName);
      if (live === undefined) return undefined;
      return output === undefined ? Unowned(live) : live;
    }),

  diff: ({
    news,
    output,
  }: {
    news: Input<ToolPolicyProps>;
    output: ToolPolicyAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* failIfInvalid(RESOURCE, String(news.toolName), firstProblem(news));
      if (output === undefined) return undefined;
      // The name is identity: a different tool is a different row.
      if (news.toolName !== output.toolName) {
        return { action: 'replace', deleteFirst: false } as const;
      }
      return differing(output, news).length === 0
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ news }: { news: ToolPolicyProps }) =>
    Effect.gen(function* () {
      yield* failIfInvalid(RESOURCE, String(news.toolName), firstProblem(news));
      // ★ THE TOOL THIS DECLARATION NAMES IS READ BY ITS NAME, never by a recorded one: a create-first
      //   replace hands reconcile no output, and the name is the whole identity.
      const before = yield* readTool(news.toolName);
      if (before === undefined || differing(before, news).length > 0) {
        yield* writeToolPolicy(updateBody(news, before));
      }
      const after = yield* readTool(news.toolName);
      if (after === undefined) {
        return yield* Effect.fail(
          new LitellmRegistryAbsentAfterWriteError({ name: news.toolName, resource: RESOURCE }),
        );
      }
      const left = differing(after, news);
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmRegistryNotConvergedError({
            fields: left,
            name: news.toolName,
            resource: RESOURCE,
          }),
        );
      }
      return after;
    }),

  /** ⛔ A RESET, not a removal: see tool-policy-operations.ts. */
  delete: ({ olds }: { olds: ToolPolicyProps }) => resetToolPolicy(olds),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and a discovered tool row has no owner mark. */
  list: () => Effect.succeed([]),
};

export const LiteLLMToolPolicyProvider = () =>
  Provider.effect(
    LiteLLMToolPolicy,
    Effect.succeed(LiteLLMToolPolicy.Provider.of(toolPolicyHandlers)),
  );

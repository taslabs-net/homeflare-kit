/**
 * `LiteLLM.AccessGroup` — one row of LiteLLM's unified access group table
 * (`LiteLLM_AccessGroupTable`, `/v1/unified_access_group`): a named bundle of models and MCP servers
 * that teams and keys are attached to. Types and what is left out: access-group-types.ts.
 *
 * ★ ADOPT BY NAME. `access_group_name` is unique in the table, so `accessGroupName` finds the one
 *   live row that carries it. A live row with no state is `Unowned`, so it needs `--adopt`.
 * ★ `defaultRemovalPolicy: 'retain'` — deleting a group detaches it from every team and key that
 *   holds it (`delete_access_group` rewrites their `access_group_ids`), and those callers lose the
 *   models and servers it granted. Opt in with `.pipe(RemovalPolicy.destroy())`.
 * ★ THE GRANTS ARE THE DECLARATION. `modelNames` and `mcpServerIds` are always compared (an
 *   undeclared list means "grants nothing"), so an adopted group that grants more is corrected.
 * ⚠️ NO LICENCE GATE ON THESE ROUTES: `access_group_endpoints.py` has no `premium_user` check
 *   (grep, 1.103.0), and docs.litellm.ai/docs/proxy/access_groups makes no Enterprise statement.
 * ⛔ NO LITELLM CREDENTIAL IS A PROP; `litellmProviders`' layer supplies `Credentials`.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import { createBody, differing, firstProblem, updateBody } from './access-group-form.ts';
import {
  createAccessGroup,
  deleteAccessGroup,
  listAccessGroups,
  updateAccessGroup,
} from './access-group-operations.ts';
import type { AccessGroupAttributes, AccessGroupProps } from './access-group-types.ts';
import {
  LitellmRegistryAbsentAfterWriteError,
  LitellmRegistryNotConvergedError,
} from './registry-errors.ts';
import { dieIfInvalid, failIfInvalid } from './registry-support.ts';

export type { AccessGroupAttributes, AccessGroupProps };
export type { RegistryError as AccessGroupError } from './registry-errors.ts';

const RESOURCE = 'LiteLLM.AccessGroup';

export interface LiteLLMAccessGroup extends Resource<
  'LiteLLM.AccessGroup',
  AccessGroupProps,
  AccessGroupAttributes
> {}

export const LiteLLMAccessGroup = Resource<LiteLLMAccessGroup>('LiteLLM.AccessGroup', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMAccessGroup = (value: unknown): value is LiteLLMAccessGroup =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.AccessGroup';

/**
 * The live row this declaration means. A RECORDED id wins and is matched by id alone: a row that
 * vanished and was recreated by hand under the same name is not silently taken over (the create
 * would then fail on the unique name, loudly). With no state, the name decides.
 */
const locate = (
  rows: readonly AccessGroupAttributes[],
  props: AccessGroupProps,
  output: AccessGroupAttributes | undefined,
) =>
  output !== undefined
    ? rows.find((row) => row.accessGroupId === output.accessGroupId)
    : rows.find((row) => row.accessGroupName === props.accessGroupName);

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const accessGroupHandlers = {
  /** ⛔ With no `output` this is the adoption probe, so the refusals run here too (registry-support.ts). */
  read: ({ olds, output }: { olds: AccessGroupProps; output: AccessGroupAttributes | undefined }) =>
    Effect.gen(function* () {
      if (output === undefined) {
        yield* dieIfInvalid(RESOURCE, String(olds.accessGroupName), firstProblem(olds));
      }
      const live = locate(yield* listAccessGroups(), olds, output);
      if (live === undefined) return undefined;
      return output === undefined ? Unowned(live) : live;
    }),

  diff: ({
    news,
    output,
  }: {
    news: Input<AccessGroupProps>;
    output: AccessGroupAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* failIfInvalid(RESOURCE, String(news.accessGroupName), firstProblem(news));
      if (output === undefined) return undefined;
      return differing(output, news).length === 0
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({
    news,
    output,
  }: {
    news: AccessGroupProps;
    output: AccessGroupAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      yield* failIfInvalid(RESOURCE, String(news.accessGroupName), firstProblem(news));
      const before = locate(yield* listAccessGroups(), news, output);
      if (before === undefined) yield* createAccessGroup(createBody(news));
      else if (differing(before, news).length > 0) {
        yield* updateAccessGroup(before.accessGroupId, updateBody(news, before));
      }

      const rows = yield* listAccessGroups();
      const after =
        before === undefined
          ? rows.find((row) => row.accessGroupName === news.accessGroupName)
          : rows.find((row) => row.accessGroupId === before.accessGroupId);
      if (after === undefined) {
        return yield* Effect.fail(
          new LitellmRegistryAbsentAfterWriteError({
            name: news.accessGroupName,
            resource: RESOURCE,
          }),
        );
      }
      const left = differing(after, news);
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmRegistryNotConvergedError({
            fields: left,
            name: news.accessGroupName,
            resource: RESOURCE,
          }),
        );
      }
      return after;
    }),

  delete: ({ output }: { output: AccessGroupAttributes }) =>
    deleteAccessGroup(output.accessGroupId),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by. */
  list: () => Effect.succeed([]),
};

export const LiteLLMAccessGroupProvider = () =>
  Provider.effect(
    LiteLLMAccessGroup,
    Effect.succeed(LiteLLMAccessGroup.Provider.of(accessGroupHandlers)),
  );

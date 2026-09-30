/**
 * `LiteLLM.Policy` — the PRODUCTION version of one named policy in LiteLLM's policy engine
 * (`LiteLLM_PolicyTable`, `/policies`): a set of guardrails to add and remove, with an optional model
 * condition. Props, the versioning and what is left out: policy-types.ts.
 *
 * ★ A CHANGE IS A NEW VERSION, PROMOTED. Only a draft is editable and only production is enforced, so
 *   an update clones production to a draft, edits it, publishes it and promotes it; the old production
 *   stays as a `published` version. A run that stops midway leaves a draft or a published copy, both
 *   inert; the next run starts from production again and never touches a version it did not make.
 * ★ ADOPT BY NAME. A live production version with no state is `Unowned`, so it needs `--adopt`.
 * ⛔ A POLICY THAT EXISTS ONLY IN config.yaml IS NEVER SHADOWED BY ACCIDENT: a create refuses when the
 *   name belongs to a config policy, because a production DB policy would override it at runtime.
 * ⛔ NO PRODUCTION VERSION IS NEVER GUESSED AT: a name whose versions are all `draft` or `published`
 *   (someone demoted it) is refused with the count, not promoted.
 * ★ `defaultRemovalPolicy: 'retain'` — deleting removes EVERY version (the history) and stops the
 *   guardrails applying wherever an attachment pointed at it. Opt in with `RemovalPolicy.destroy()`.
 * ⚠️ NO LICENCE GATE ON THESE ROUTES: `policy_endpoints.py` and `policy_engine/*.py` have no
 *   `premium_user` check (grep, 1.103.0). The docs page says team/key-based attachment needs Enterprise
 *   (docs.litellm.ai/docs/proxy/guardrails/guardrail_policies); whether a CE proxy enforces one is
 *   UNVERIFIED. The `policies` metadata of a team or key IS gated (`_premium_user_check`).
 * ⛔ NO LITELLM CREDENTIAL IS A PROP; `litellmProviders`' layer supplies `Credentials`.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import { createBody, differing, firstProblem, toAttributes, updateBody } from './policy-form.ts';
import {
  configPolicyNames,
  createDraft,
  createPolicy,
  deleteAllVersions,
  editDraft,
  listPolicyVersions,
  setVersionStatus,
} from './policy-operations.ts';
import type { PolicyAttributes, PolicyProps, PolicyVersion } from './policy-types.ts';
import {
  LitellmRegistryAbsentAfterWriteError,
  LitellmRegistryInvalidError,
  LitellmRegistryNotConvergedError,
} from './registry-errors.ts';
import { dieIfInvalid, failIfInvalid } from './registry-support.ts';

export type { PolicyAttributes, PolicyProps };
export type { RegistryError as PolicyError } from './registry-errors.ts';

const RESOURCE = 'LiteLLM.Policy';

export interface LiteLLMPolicy extends Resource<'LiteLLM.Policy', PolicyProps, PolicyAttributes> {}

export const LiteLLMPolicy = Resource<LiteLLMPolicy>('LiteLLM.Policy', {
  defaultRemovalPolicy: 'retain',
});

export const isLiteLLMPolicy = (value: unknown): value is LiteLLMPolicy =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.Policy';

const production = (versions: readonly PolicyVersion[]) =>
  versions.find((version) => version.versionStatus === 'production');

const invalid = (name: string, problem: string) =>
  Effect.fail(new LitellmRegistryInvalidError({ name, problem, resource: RESOURCE }));

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const policyHandlers = {
  /** ⛔ With no `output` this is the adoption probe, so the refusals run here too (registry-support.ts). */
  read: ({ olds, output }: { olds: PolicyProps; output: PolicyAttributes | undefined }) =>
    Effect.gen(function* () {
      if (output === undefined) {
        yield* dieIfInvalid(RESOURCE, String(olds.policyName), firstProblem(olds));
      }
      const live = production(yield* listPolicyVersions(output?.policyName ?? olds.policyName));
      if (live === undefined) return undefined;
      return output === undefined ? Unowned(toAttributes(live)) : toAttributes(live);
    }),

  diff: ({ news, output }: { news: Input<PolicyProps>; output: PolicyAttributes | undefined }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* failIfInvalid(RESOURCE, String(news.policyName), firstProblem(news));
      if (output === undefined) return undefined;
      // The name is identity: a different name is a different policy.
      if (news.policyName !== output.policyName) {
        return { action: 'replace', deleteFirst: false } as const;
      }
      return differing(output, news).length === 0
        ? ({ action: 'noop' } as const)
        : ({ action: 'update' } as const);
    }),

  reconcile: ({ news }: { news: PolicyProps }) =>
    Effect.gen(function* () {
      yield* failIfInvalid(RESOURCE, String(news.policyName), firstProblem(news));
      const versions = yield* listPolicyVersions(news.policyName);
      const live = production(versions);
      if (versions.length === 0) {
        if ((yield* configPolicyNames()).includes(news.policyName)) {
          return yield* invalid(
            news.policyName,
            'a policy of this name is defined in config.yaml, and a production DB policy would override it at runtime; rename this one or remove the config policy first',
          );
        }
        yield* createPolicy(createBody(news));
      } else if (live === undefined) {
        return yield* invalid(
          news.policyName,
          `${versions.length} version(s) exist and none is production, so the policy is inactive; promote one in LiteLLM (or delete its versions) instead of letting this guess`,
        );
      } else if (differing(live, news).length > 0) {
        const draft = yield* createDraft(news.policyName);
        yield* editDraft(draft.policyId, updateBody(news, live));
        yield* setVersionStatus(draft.policyId, 'published');
        yield* setVersionStatus(draft.policyId, 'production');
      }

      const after = production(yield* listPolicyVersions(news.policyName));
      if (after === undefined) {
        return yield* Effect.fail(
          new LitellmRegistryAbsentAfterWriteError({ name: news.policyName, resource: RESOURCE }),
        );
      }
      const left = differing(after, news);
      if (left.length > 0) {
        return yield* Effect.fail(
          new LitellmRegistryNotConvergedError({
            fields: left,
            name: news.policyName,
            resource: RESOURCE,
          }),
        );
      }
      return toAttributes(after);
    }),

  delete: ({ output }: { output: PolicyAttributes }) => deleteAllVersions(output.policyName),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by. */
  list: () => Effect.succeed([]),
};

export const LiteLLMPolicyProvider = () =>
  Provider.effect(LiteLLMPolicy, Effect.succeed(LiteLLMPolicy.Provider.of(policyHandlers)));

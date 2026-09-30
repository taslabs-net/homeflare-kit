/**
 * `LiteLLM.PolicyAttachment` — one row of LiteLLM's policy attachment table
 * (`/policies/attachments`): WHERE a policy applies, by team alias, key alias, model and tag. Props,
 * the global-by-default trap and the config-file exclusion: policy-attachment-types.ts.
 *
 * ⛔ IMMUTABLE, SO EVERY CHANGE IS A CREATE-FIRST REPLACE. There is no update route. The engine creates
 *   the new attachment and then deletes the old, so both apply for a moment; guardrails are additive,
 *   so that can only add enforcement.
 * ★ THE REMOVAL POLICY IS THE DEFAULT (`destroy`), DELIBERATELY NOT `retain` (the other registry
 *   resources retain). Under `retain` a replace would leave the OLD attachment live beside the new one
 *   for good: a scope the declaration no longer names would keep the policy attached. An attachment
 *   holds no data, so removing it loses nothing but the scoping the declaration just dropped.
 * ★ ADOPT BY CONTENT. A live attachment that matches every field, with no state, is `Unowned` and needs
 *   `--adopt`. Two identical live rows are refused, never guessed at.
 * ⚠️ NO LICENCE GATE ON THESE ROUTES: none in `policy_endpoints.py` or `policy_engine/*.py` (1.103.0).
 *   The guardrail-policies docs page says team/key-based attachment needs Enterprise
 *   (docs.litellm.ai/docs/proxy/guardrails/guardrail_policies); whether a CE proxy enforces a
 *   team-scoped attachment is UNVERIFIED.
 * ⛔ NO LITELLM CREDENTIAL IS A PROP; `litellmProviders`' layer supplies `Credentials`.
 */
import { Resource } from 'alchemy';
import { Unowned } from 'alchemy/AdoptPolicy';
import { isResolved } from 'alchemy/Diff';
import type { Input } from 'alchemy/Input';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import * as Predicate from 'effect/Predicate';
import { createBody, differing, firstProblem } from './policy-attachment-form.ts';
import {
  createAttachment,
  deleteAttachment,
  listAttachments,
} from './policy-attachment-operations.ts';
import type {
  PolicyAttachmentAttributes,
  PolicyAttachmentProps,
} from './policy-attachment-types.ts';
import {
  LitellmRegistryAbsentAfterWriteError,
  LitellmRegistryAmbiguousError,
  LitellmRegistryNotConvergedError,
  LitellmRegistryUnreadableError,
} from './registry-errors.ts';
import { dieIfInvalid, failIfInvalid } from './registry-support.ts';

export type { PolicyAttachmentAttributes, PolicyAttachmentProps };
export type { RegistryError as PolicyAttachmentError } from './registry-errors.ts';

const RESOURCE = 'LiteLLM.PolicyAttachment';

export interface LiteLLMPolicyAttachment extends Resource<
  'LiteLLM.PolicyAttachment',
  PolicyAttachmentProps,
  PolicyAttachmentAttributes
> {}

export const LiteLLMPolicyAttachment = Resource<LiteLLMPolicyAttachment>(
  'LiteLLM.PolicyAttachment',
);

export const isLiteLLMPolicyAttachment = (value: unknown): value is LiteLLMPolicyAttachment =>
  Predicate.hasProperty(value, 'Type') && value.Type === 'LiteLLM.PolicyAttachment';

/**
 * The live row this declaration means: a RECORDED id is matched by id alone (a row that vanished is
 * `undefined`); with no state, the rows equal to the declaration decide, and a twin is refused.
 */
const locate = (
  rows: readonly PolicyAttachmentAttributes[],
  props: PolicyAttachmentProps,
  output: PolicyAttachmentAttributes | undefined,
) => {
  if (output !== undefined) {
    return Effect.succeed(rows.find((row) => row.attachmentId === output.attachmentId));
  }
  const equal = rows.filter((row) => differing(row, props).length === 0);
  return equal.length > 1
    ? Effect.fail(
        new LitellmRegistryAmbiguousError({
          ids: equal.map((row) => row.attachmentId),
          name: props.policyName,
          resource: RESOURCE,
        }),
      )
    : Effect.succeed(equal[0]);
};

/** ⛔ TEST-ONLY EXPORT. Not on index.ts's barrel. */
export const policyAttachmentHandlers = {
  /** ⛔ With no `output` this is the adoption probe, so the refusals run here too (registry-support.ts). */
  read: ({
    olds,
    output,
  }: {
    olds: PolicyAttachmentProps;
    output: PolicyAttachmentAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (output === undefined) {
        yield* dieIfInvalid(RESOURCE, String(olds.policyName), firstProblem(olds));
      }
      const live = yield* locate(yield* listAttachments(), olds, output);
      if (live === undefined) return undefined;
      return output === undefined ? Unowned(live) : live;
    }),

  diff: ({
    news,
    output,
  }: {
    news: Input<PolicyAttachmentProps>;
    output: PolicyAttachmentAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      if (!isResolved(news)) return undefined;
      yield* failIfInvalid(RESOURCE, String(news.policyName), firstProblem(news));
      if (output === undefined) return undefined;
      // ⛔ no update route: any difference is a new attachment, created before the old one goes
      return differing(output, news).length === 0
        ? ({ action: 'noop' } as const)
        : ({ action: 'replace', deleteFirst: false } as const);
    }),

  reconcile: ({
    news,
    output,
  }: {
    news: PolicyAttachmentProps;
    output: PolicyAttachmentAttributes | undefined;
  }) =>
    Effect.gen(function* () {
      yield* failIfInvalid(RESOURCE, String(news.policyName), firstProblem(news));
      const before = yield* locate(yield* listAttachments(), news, output);
      // an attachment that already IS the declaration is kept, whether it is ours or being adopted
      if (before !== undefined && differing(before, news).length === 0) return before;

      const created = yield* createAttachment(createBody(news));
      if (created === undefined) {
        return yield* Effect.fail(
          new LitellmRegistryUnreadableError({
            reason: 'the create answered something that is not an attachment',
            resource: RESOURCE,
          }),
        );
      }
      const after = (yield* listAttachments()).find(
        (row) => row.attachmentId === created.attachmentId,
      );
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
      return after;
    }),

  delete: ({ output }: { output: PolicyAttachmentAttributes }) =>
    deleteAttachment(output.attachmentId),

  /** ⛔ EMPTY: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by. */
  list: () => Effect.succeed([]),
};

export const LiteLLMPolicyAttachmentProvider = () =>
  Provider.effect(
    LiteLLMPolicyAttachment,
    Effect.succeed(LiteLLMPolicyAttachment.Provider.of(policyAttachmentHandlers)),
  );

/**
 * Wire bodies, comparison and refusals for `LiteLLM.Policy`, testable without a server.
 *
 * ★ THE EDIT BODY CARRIES ONLY WHAT DIFFERS AND IS NEVER A `null`: `update_policy_in_db` skips every
 *   field that is `None` (policy-types.ts), so a `null` would be a silent no-op the read back would
 *   then have to catch.
 */
import type * as policies from '@distilled.cloud/litellm/policy_engine';
import {
  asRow,
  canonical,
  firstBadEntry,
  firstDuplicate,
  isBlank,
  numberOrNull,
  sameSet,
  stringOrNull,
  stringsOf,
} from './registry-support.ts';
import type { PolicyAttributes, PolicyProps, PolicyVersion } from './policy-types.ts';

/** The first reason a declaration is refused, or `undefined`. Runs before any request. */
export const firstProblem = (props: PolicyProps): string | undefined => {
  if (isBlank(props.policyName) || props.policyName !== props.policyName.trim()) {
    return '`policyName` must be a non-blank name with no leading or trailing space';
  }
  for (const [field, value] of [
    ['description', props.description],
    ['inherit', props.inherit],
    ['conditionModel', props.conditionModel],
  ] as const) {
    if (value !== undefined && isBlank(value)) {
      return `\`${field}\` is blank; leave it out to keep the live value (a policy field cannot be cleared)`;
    }
  }
  if (props.inherit === props.policyName) return '`inherit` names the policy itself';
  for (const [field, values] of [
    ['guardrailsAdd', props.guardrailsAdd ?? []],
    ['guardrailsRemove', props.guardrailsRemove ?? []],
  ] as const) {
    const bad = firstBadEntry(values);
    if (bad !== undefined)
      return `\`${field}\` has a blank or padded entry (${JSON.stringify(bad)})`;
    const twice = firstDuplicate(values);
    if (twice !== undefined) return `\`${field}\` lists ${JSON.stringify(twice)} twice`;
  }
  const both = (props.guardrailsAdd ?? []).find((name) =>
    (props.guardrailsRemove ?? []).includes(name),
  );
  if (both !== undefined) return `guardrail ${JSON.stringify(both)} is both added and removed`;
  return undefined;
};

/** One policy version. `undefined` is "not a policy row": the caller refuses the whole answer. */
export const toVersion = (value: unknown): PolicyVersion | undefined => {
  const row = asRow(value);
  if (row === undefined) return undefined;
  const policyId = row['policy_id'];
  const policyName = row['policy_name'];
  if (typeof policyId !== 'string' || typeof policyName !== 'string') return undefined;
  const condition = asRow(row['condition']);
  return {
    conditionModel: stringOrNull(condition?.['model']),
    description: stringOrNull(row['description']),
    guardrailsAdd: canonical(stringsOf(row['guardrails_add'])),
    guardrailsRemove: canonical(stringsOf(row['guardrails_remove'])),
    inherit: stringOrNull(row['inherit']),
    policyId,
    policyName,
    versionNumber: numberOrNull(row['version_number']) ?? 1,
    versionStatus: typeof row['version_status'] === 'string' ? row['version_status'] : 'production',
  };
};

/** The attributes of a version: without the status, which is never recorded. */
export const toAttributes = (version: PolicyVersion): PolicyAttributes => {
  const { versionStatus: _status, ...attributes } = version;
  return attributes;
};

/** Wire names of the fields where live and declared disagree. */
export const differing = (live: PolicyAttributes, props: PolicyProps): readonly string[] => {
  const fields: string[] = [];
  if (props.description !== undefined && live.description !== props.description) {
    fields.push('description');
  }
  if (props.inherit !== undefined && live.inherit !== props.inherit) fields.push('inherit');
  if (!sameSet(live.guardrailsAdd, props.guardrailsAdd ?? [])) fields.push('guardrails_add');
  if (!sameSet(live.guardrailsRemove, props.guardrailsRemove ?? []))
    fields.push('guardrails_remove');
  if (props.conditionModel !== undefined && live.conditionModel !== props.conditionModel) {
    fields.push('condition');
  }
  return fields;
};

/** Create body (version 1, which LiteLLM makes production): every declared field. */
export const createBody = (props: PolicyProps): policies.CreatePolicyPoliciesPostRequest => ({
  guardrails_add: [...(props.guardrailsAdd ?? [])],
  guardrails_remove: [...(props.guardrailsRemove ?? [])],
  policy_name: props.policyName,
  ...(props.description === undefined ? {} : { description: props.description }),
  ...(props.inherit === undefined ? {} : { inherit: props.inherit }),
  ...(props.conditionModel === undefined ? {} : { condition: { model: props.conditionModel } }),
});

/** Draft edit body: only the fields that differ from what the draft was cloned from. */
export const updateBody = (
  props: PolicyProps,
  live: PolicyAttributes,
): Omit<policies.UpdatePolicyPoliciesPolicyIdPutRequest, 'policy_id'> => {
  const changed = new Set(differing(live, props));
  return {
    ...(changed.has('description') ? { description: props.description ?? null } : {}),
    ...(changed.has('inherit') ? { inherit: props.inherit ?? null } : {}),
    ...(changed.has('guardrails_add') ? { guardrails_add: [...(props.guardrailsAdd ?? [])] } : {}),
    ...(changed.has('guardrails_remove')
      ? { guardrails_remove: [...(props.guardrailsRemove ?? [])] }
      : {}),
    ...(changed.has('condition') ? { condition: { model: props.conditionModel ?? null } } : {}),
  };
};

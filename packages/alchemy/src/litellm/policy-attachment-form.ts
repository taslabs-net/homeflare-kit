/**
 * Wire bodies, comparison and refusals for `LiteLLM.PolicyAttachment`, testable without a server.
 *
 * ★ TWO ATTACHMENTS ARE "THE SAME" WHEN EVERY FIELD IS: the policy, the scope, the four selector SETS
 *   and the priority. That is the only identity an attachment has (policy-attachment-types.ts), and
 *   it is what adoption and the read back both use.
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
import type {
  PolicyAttachmentAttributes,
  PolicyAttachmentProps,
} from './policy-attachment-types.ts';

const SELECTORS = ['teams', 'keys', 'models', 'tags'] as const;

/** The first reason a declaration is refused, or `undefined`. Runs before any request. */
export const firstProblem = (props: PolicyAttachmentProps): string | undefined => {
  if (isBlank(props.policyName) || props.policyName !== props.policyName.trim()) {
    return '`policyName` must be a non-blank name with no leading or trailing space';
  }
  if (props.scope !== undefined && props.scope !== '*') return "`scope` can only be '*'";
  for (const field of SELECTORS) {
    const values = props[field] ?? [];
    const bad = firstBadEntry(values);
    if (bad !== undefined)
      return `\`${field}\` has a blank or padded entry (${JSON.stringify(bad)})`;
    const twice = firstDuplicate(values);
    if (twice !== undefined) return `\`${field}\` lists ${JSON.stringify(twice)} twice`;
  }
  if (props.scope === undefined && SELECTORS.every((field) => (props[field] ?? []).length === 0)) {
    return "no `scope`, `teams`, `keys`, `models` or `tags`: LiteLLM treats an attachment with no selector as GLOBAL, so declare `scope: '*'` if that is meant";
  }
  if (
    props.priority !== undefined &&
    !(
      Number.isInteger(props.priority) &&
      props.priority >= -2147483648 &&
      props.priority <= 2147483647
    )
  ) {
    return '`priority` must be a 32-bit integer';
  }
  return undefined;
};

/** One attachment row. `undefined` is "not an attachment", and so is a config-file one. */
export const toAttributes = (value: unknown): PolicyAttachmentAttributes | undefined => {
  const row = asRow(value);
  if (row === undefined) return undefined;
  const attachmentId = row['attachment_id'];
  const policyName = row['policy_name'];
  if (typeof attachmentId !== 'string' || typeof policyName !== 'string') return undefined;
  return {
    attachmentId,
    keys: canonical(stringsOf(row['keys'])),
    models: canonical(stringsOf(row['models'])),
    policyName,
    priority: numberOrNull(row['priority']),
    scope: stringOrNull(row['scope']),
    tags: canonical(stringsOf(row['tags'])),
    teams: canonical(stringsOf(row['teams'])),
  };
};

/** Whether a live row is defined in config.yaml (its synthetic id is `config-<n>`): out of reach of the API. */
export const isConfigRow = (value: unknown): boolean =>
  asRow(value)?.['definition_location'] === 'config';

/** Wire names of the fields where live and declared disagree. Empty means "the same attachment". */
export const differing = (
  live: PolicyAttachmentAttributes,
  props: PolicyAttachmentProps,
): readonly string[] => {
  const fields: string[] = [];
  if (live.policyName !== props.policyName) fields.push('policy_name');
  if ((live.scope ?? null) !== (props.scope ?? null)) fields.push('scope');
  for (const field of SELECTORS) if (!sameSet(live[field], props[field] ?? [])) fields.push(field);
  if (live.priority !== (props.priority ?? null)) fields.push('priority');
  return fields;
};

export const createBody = (
  props: PolicyAttachmentProps,
): policies.CreatePolicyAttachmentPoliciesAttachmentsPostRequest => ({
  policy_name: props.policyName,
  ...(props.scope === undefined ? {} : { scope: props.scope }),
  ...(props.teams === undefined ? {} : { teams: [...props.teams] }),
  ...(props.keys === undefined ? {} : { keys: [...props.keys] }),
  ...(props.models === undefined ? {} : { models: [...props.models] }),
  ...(props.tags === undefined ? {} : { tags: [...props.tags] }),
  ...(props.priority === undefined ? {} : { priority: props.priority }),
});

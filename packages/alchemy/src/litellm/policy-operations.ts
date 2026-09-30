/**
 * The seven LiteLLM `/policies*` calls `LiteLLM.Policy` uses, through the SDK's typed operations in
 * `@distilled.cloud/litellm/policy_engine` (LiteLLM 1.103.0):
 *
 *   versions  `listPolicyVersionsPoliciesNamePolicyNameVersionsGet`      GET    /policies/name/{policy_name}/versions
 *   config    `listPoliciesPoliciesListGet`                              GET    /policies/list?version_status=production
 *   create    `createPolicyPoliciesPost`                                 POST   /policies
 *   draft     `createPolicyVersionPoliciesNamePolicyNameVersionsPost`    POST   /policies/name/{policy_name}/versions
 *   edit      `updatePolicyPoliciesPolicyIdPut`                          PUT    /policies/{policy_id}
 *   status    `updatePolicyVersionStatusPoliciesPolicyIdStatusPut`       PUT    /policies/{policy_id}/status
 *   delete    `deleteAllPolicyVersionsPoliciesNamePolicyNameAllVersionsDelete` DELETE /policies/name/{policy_name}/all-versions
 *
 * ⛔ THE VERSION LIST IS THE TABLE AND ANSWERS ABSENCE WITH AN EMPTY LIST. `get_versions_by_policy_name`
 *   is a `find_many` by name (`policy_registry.py`, 1.103.0), so a name with no rows is `versions: []`
 *   with a 200, never a 404. Nothing here needs the SDK's undeclared `NotFound`.
 * ⛔ A CONFIG-FILE POLICY IS NOT IN THE TABLE. `/policies/list` merges DB rows with config.yaml
 *   policies (`definition_location: "config"`), and a production DB policy of the same name OVERRIDES the
 *   config one at runtime. `configPolicyNames` is how a create refuses to do that by accident.
 * ⚠️ MOST FAILURES HERE ARE A PLAIN 500. The handlers wrap everything in `except Exception` and answer
 *   `HTTPException(500, detail=str(e))`, except a duplicate name (400) and a few 404/400 cases matched
 *   by message text. The SDK retries 5xx with backoff, so a genuine failure is slow to surface; nothing
 *   here reads the text either way (S21).
 * ⛔ DELETE REMOVES EVERY VERSION (`delete_many` by name), not just production, and answers 200 whether
 *   or not any row existed, so it is idempotent as it stands. It is why the resource defaults to `retain`.
 */
import * as policies from '@distilled.cloud/litellm/policy_engine';
import * as Effect from 'effect/Effect';
import { throughFetch } from './operations.ts';
import { toVersion } from './policy-form.ts';
import type { PolicyVersion } from './policy-types.ts';
import { LitellmRegistryUnreadableError } from './registry-errors.ts';
import { asRow, bodyOf } from './registry-support.ts';

const RESOURCE = 'LiteLLM.Policy';

const unreadable = (reason: string) =>
  new LitellmRegistryUnreadableError({ reason, resource: RESOURCE });

/** Every version of one policy name, newest first as LiteLLM orders them. `[]` when there is none. */
export const listPolicyVersions = (policyName: string) =>
  throughFetch(
    policies.listPolicyVersionsPoliciesNamePolicyNameVersionsGet({ policy_name: policyName }),
  ).pipe(
    Effect.flatMap((response) => {
      const versions = asRow(bodyOf(response))?.['versions'];
      if (versions === undefined) return Effect.succeed<readonly PolicyVersion[]>([]);
      if (!Array.isArray(versions)) return Effect.fail(unreadable('versions is not an array'));
      const parsed = versions.map(toVersion);
      return parsed.every((each) => each !== undefined)
        ? Effect.succeed(parsed as readonly PolicyVersion[])
        : Effect.fail(unreadable('a version has no id or name'));
    }),
  );

/** The names of the policies defined in config.yaml (their `definition_location` is `config`). */
export const configPolicyNames = () =>
  throughFetch(policies.listPoliciesPoliciesListGet({ version_status: 'production' })).pipe(
    Effect.flatMap((response) => {
      const rows = asRow(bodyOf(response))?.['policies'];
      if (!Array.isArray(rows)) return Effect.fail(unreadable('policies is not an array'));
      return Effect.succeed(
        rows.flatMap((row) => {
          const each = asRow(row);
          return each?.['definition_location'] === 'config' &&
            typeof each['policy_name'] === 'string'
            ? [each['policy_name']]
            : [];
        }),
      );
    }),
  );

/** Creates version 1 AS PRODUCTION. */
export const createPolicy = (body: policies.CreatePolicyPoliciesPostRequest) =>
  throughFetch(policies.createPolicyPoliciesPost(body)).pipe(Effect.asVoid);

/** A new DRAFT cloned from production. Answers the draft, whose id every later call needs. */
export const createDraft = (policyName: string) =>
  throughFetch(
    policies.createPolicyVersionPoliciesNamePolicyNameVersionsPost({ policy_name: policyName }),
  ).pipe(
    Effect.flatMap((response) => {
      const draft = toVersion(bodyOf(response));
      return draft === undefined
        ? Effect.fail(unreadable('the new draft is not a policy'))
        : Effect.succeed(draft);
    }),
  );

export const editDraft = (
  policyId: string,
  body: Omit<policies.UpdatePolicyPoliciesPolicyIdPutRequest, 'policy_id'>,
) =>
  throughFetch(policies.updatePolicyPoliciesPolicyIdPut({ ...body, policy_id: policyId })).pipe(
    Effect.asVoid,
  );

/** `draft → published` or `published → production` (which demotes the old production to published). */
export const setVersionStatus = (policyId: string, status: 'published' | 'production') =>
  throughFetch(
    policies.updatePolicyVersionStatusPoliciesPolicyIdStatusPut({
      policy_id: policyId,
      version_status: status,
    }),
  ).pipe(Effect.asVoid);

export const deleteAllVersions = (policyName: string) =>
  throughFetch(
    policies.deleteAllPolicyVersionsPoliciesNamePolicyNameAllVersionsDelete({
      policy_name: policyName,
    }),
  ).pipe(Effect.asVoid);

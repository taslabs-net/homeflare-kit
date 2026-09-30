# LiteLLM — `LiteLLM.Policy`

The **production version** of one named policy in LiteLLM's policy engine (`LiteLLM_PolicyTable`,
`/policies`): guardrails to add, guardrails to remove from an inherited parent, and an optional model
condition. Where it applies is a [`LiteLLM.PolicyAttachment`](./litellm-policy-attachment.md). Typed calls
come from `@distilled.cloud/litellm/policy_engine`, generated from LiteLLM **v1.103.0**; credentials and
the family's other refusals are in [litellm.md](./litellm.md).

Everything marked "read" was read from the **live 1.103.0 container's source** on 2026-09-30 (no request was
sent to a proxy). The docs page is docs.litellm.ai/docs/proxy/guardrails/guardrail_policies.

## ⛔ A policy is versioned; this resource manages the production version

LiteLLM keeps every version (`draft` → `published` → `production`) and only **production** is enforced.
`POST /policies` creates version 1 **as production**, and `PUT /policies/{id}` edits a **draft only** (400
otherwise; `policy_endpoints.py`, `policy_registry.py`). So a change is four calls:

1. `POST /policies/name/{name}/versions` — a new draft cloned from production;
2. `PUT /policies/{draft}` — edit the fields that differ;
3. `PUT /policies/{draft}/status` `published`;
4. `PUT /policies/{draft}/status` `production` — which demotes the old production to `published`.

The old version stays as history. `policyId` in the attributes is the **production** version's id and changes
with every promotion. A run that stops midway leaves a draft or a published copy, both inert (drafts are not
loaded into memory); the next run starts again from production and **never touches a version it did not
make**, because promoting a person's draft would put their unmanaged fields into production.
(The docs page describes no version lifecycle at all; the source is authoritative.)

## The distilled operations it uses

| step     | operation (`@distilled.cloud/litellm/policy_engine`)             | route                                          |
| -------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| versions | `listPolicyVersionsPoliciesNamePolicyNameVersionsGet`            | `GET /policies/name/{name}/versions`           |
| config   | `listPoliciesPoliciesListGet`                                    | `GET /policies/list?version_status=production` |
| create   | `createPolicyPoliciesPost`                                       | `POST /policies`                               |
| draft    | `createPolicyVersionPoliciesNamePolicyNameVersionsPost`          | `POST /policies/name/{name}/versions`          |
| edit     | `updatePolicyPoliciesPolicyIdPut`                                | `PUT /policies/{id}`                           |
| status   | `updatePolicyVersionStatusPoliciesPolicyIdStatusPut`             | `PUT /policies/{id}/status`                    |
| delete   | `deleteAllPolicyVersionsPoliciesNamePolicyNameAllVersionsDelete` | `DELETE /policies/name/{name}/all-versions`    |

## Example

```ts
import { LiteLLMPolicy, litellmProviders } from '@homeflare/alchemy/litellm';

export class Baseline extends LiteLLMPolicy('Baseline', {
  policyName: 'estate-baseline',
  description: 'Guardrails every estate request gets',
  guardrailsAdd: ['pii-mask', 'prompt-injection'],
  conditionModel: 'cf-*',
}) {}
```

## Behaviour

| Concern     | Rule                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `policyName`. A different name is a different policy: a `replace`, create-first, the old one retained.                                                                          |
| Adopt       | A live **production** version with no state is `Unowned` and needs `--adopt`; found by name. A matching one writes nothing.                                                     |
| Guardrails  | `guardrailsAdd` and `guardrailsRemove` are always compared, as sets (default `[]`).                                                                                             |
| Other       | `description`, `inherit` and `conditionModel` are compared **only when declared**.                                                                                              |
| Removal     | `defaultRemovalPolicy: 'retain'`. Opt in with `RemovalPolicy.destroy()`. `delete` removes **every version** (`delete_many` by name) and answers 200 whether or not any existed. |
| Write check | Reconcile lists the versions again and fails (`LitellmRegistryNotConvergedError` / `…AbsentAfterWriteError`) if production does not match.                                      |

⚠️ **A field cannot be cleared through the API.** `update_policy_in_db` writes only fields that are not `None`,
so removing `description`, `inherit` or `conditionModel` from the declaration leaves the live value (they are
"compared only when declared" for that reason). The two guardrail lists can be written as `[]`.

## Two guards on a create

- **A config.yaml policy is never shadowed by accident.** `/policies/list` merges DB rows with config policies
  (`definition_location: "config"`), and a production DB policy of the same name **overrides** the config one at
  runtime. A create for a name that belongs to a config policy is refused.
- **No production version is never guessed at.** A name whose versions are all `draft` or `published` (someone
  demoted it, so it is inactive) is refused with the count, not promoted.

## Refused before any request

A blank or padded `policyName`; a blank `description`, `inherit` or `conditionModel`; `inherit` naming the policy
itself; a blank, padded or repeated guardrail; a guardrail both added and removed.

## Licence gating (measured)

None in the policy routes: `policy_endpoints.py`, `policy_registry.py`, `attachment_registry.py`,
`policy_matcher.py` and `policy_validator.py` have no `premium_user` reference (`grep -ci premium`: 0 in each).
The docs page says team/key-based policy attachment needs Enterprise; whether a community proxy enforces a
team-scoped attachment is **UNVERIFIED**. The `policies` and `guardrails` **metadata of a team or key IS
gated** (`_premium_user_check`, `litellm_pre_call_utils.py` lines 2949-3023 and `common_utils.py` line 464),
which is why `LiteLLM.Team` never sends them.

## Not modelled

`pipeline` (an ordered guardrail pipeline): a new version is cloned from production, so an adopted policy's
pipeline survives every update, and none is ever sent. Whether the named guardrails exist is not checked
(LiteLLM does not check it on write).

## Unmeasured at 1.103.0

No live proxy was contacted. The fake (`fake-policy-litellm.ts`) is built from the source; each choice is in its
header. Most failures of these routes are a plain **500** (the handlers wrap everything in `except Exception`),
and the SDK retries 5xx with backoff, so a genuine failure is slow to surface; nothing here reads the text of
one. The typed fix for this tag's undeclared 400 and 404 is a distilled patch, which belongs in the distilled
clone and is not part of this change.

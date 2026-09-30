# LiteLLM — `LiteLLM.PolicyAttachment`

One row of LiteLLM's policy attachment table (`LiteLLM_PolicyAttachmentTable`, `/policies/attachments`): **where**
a [policy](./litellm-policy.md) applies, by team alias, key alias, model and tag. Typed calls come from
`@distilled.cloud/litellm/policy_engine`, generated from LiteLLM **v1.103.0**; credentials and the family's
other refusals are in [litellm.md](./litellm.md).

Everything marked "read" was read from the **live 1.103.0 container's source** on 2026-09-30 (no request was
sent to a proxy). The docs page is docs.litellm.ai/docs/proxy/guardrails/guardrail_policies.

## The distilled operations it uses

| step   | operation (`@distilled.cloud/litellm/policy_engine`)          | route                               |
| ------ | ------------------------------------------------------------- | ----------------------------------- |
| list   | `listPolicyAttachmentsPoliciesAttachmentsListGet`             | `GET /policies/attachments/list`    |
| create | `createPolicyAttachmentPoliciesAttachmentsPost`               | `POST /policies/attachments`        |
| delete | `deletePolicyAttachmentPoliciesAttachmentsAttachmentIdDelete` | `DELETE /policies/attachments/{id}` |

There is **no update operation**, because the API has none (`policy_endpoints.py` has create, get, list and
delete). The by-id `GET` is not used: the list carries every field and answers absence without a 404.

## ⛔ An attachment with no selector is GLOBAL

A request gets the policy when it matches **all** of the attachment's selectors (`PolicyMatcher.scope_matches`,
`policy_matcher.py`). `PolicyScope.get_teams()`, `get_keys()` and `get_models()` each default to `["*"]` when
empty, and empty `tags` are simply not checked (`policy_types.py`). So an attachment that names only a policy
applies to **every request**, and `{ teams: ['x'] }` covers every key and every model of team x.

An attachment with no `scope`, `teams`, `keys`, `models` or `tags` is therefore **refused** unless `scope: '*'`
says a global attachment is meant.

## Example

```ts
import { LiteLLMPolicyAttachment, litellmProviders } from '@homeflare/alchemy/litellm';

export class CodeOnly extends LiteLLMPolicyAttachment('CodeOnly', {
  policyName: baseline.policyName, // a LiteLLM.Policy: the dependency edge is the Output
  teams: [estate.teamAlias], // team ALIASES, from a LiteLLM.Team: it must exist before the attachment
  models: ['cf-*'],
  priority: 10,
}) {}
```

Teams, keys and models are matched by alias or model name with `*` wildcards (`prefix-*`). `tags` match
key and team `metadata.tags`. A `teams` entry is `LiteLLM.Team`'s `teamAlias`, **not its id**, and an alias is
not unique in LiteLLM, so two teams sharing one are both matched.

## Behaviour

| Concern     | Rule                                                                                                                                                                                                 |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | **Content.** The id is the proxy's and there is no name, so two attachments are "the same" when the policy, scope, the four selector sets and the priority all are.                                  |
| Adopt       | A live attachment that equals the declaration, with no state, is `Unowned` and needs `--adopt`. Two identical live rows are refused (`LitellmRegistryAmbiguousError`), never guessed at.             |
| Change      | Always a **`replace`, create-first**: the new attachment is created, then the old one is deleted. For a moment both apply. Guardrails are additive, so that can only add enforcement, never drop it. |
| Removal     | The **default** removal policy (`destroy`), deliberately not `retain`. Under `retain` a replace would leave the old attachment live beside the new one for good. An attachment holds no data.        |
| Delete      | Idempotent by a real read: a failed DELETE (a missing id is a 404) is swallowed only when the list no longer has the id. A 403 re-raises the original error.                                         |
| Config file | Attachments defined in config.yaml (`definition_location: "config"`, ids `config-<n>`) can never be deleted through the API, so they are never listed, adopted or removed here.                      |
| Write check | Reconcile lists again and fails (`LitellmRegistryNotConvergedError` / `…AbsentAfterWriteError`) if the created attachment differs from the declaration or is not there.                              |

## What the proxy refuses, and this resource does not repeat

`create_policy_attachment` answers **404** for a policy with no production version, and **400** for a concrete
team, key or model selector that resolves to nothing (`PolicyValidator.find_invalid_scope_entries`); wildcard
patterns are let through and may match nothing today. Declaring `teams` from `team.teamAlias` gives the
dependency edge that makes the team exist first. Most other failures are a plain **500** (the handlers wrap
everything in `except Exception`), which the SDK retries with backoff.

## Refused before any request

A blank or padded `policyName`; a `scope` other than `'*'`; a blank, padded or repeated selector entry; no
selector at all (above); a `priority` that is not a 32-bit integer.

## Licence gating (measured)

None in the routes: `policy_endpoints.py`, `attachment_registry.py`, `policy_matcher.py` and
`policy_validator.py` have no `premium_user` reference (`grep -ci premium`: 0 in each). The docs page states
that "team/key-based policy attachment requires a LiteLLM Enterprise license". Whether that describes these
routes, or the gated `policies` metadata of a team or key, or request-time matching on a community proxy, is
**UNVERIFIED**: nothing was run, and the source shows no gate in the attachment path.

## Unmeasured at 1.103.0

No live proxy was contacted. The fake (`fake-policy-attachment-litellm.ts`) is built from the source; each
choice is in its header. The typed fix for this tag's undeclared 400, 404 and 500 answers is a distilled patch,
which belongs in the distilled clone and is not part of this change.

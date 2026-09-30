# LiteLLM — `LiteLLM.ToolPolicy`

The input and output trust policy of one tool in LiteLLM's tool registry (`LiteLLM_ToolTable`,
`POST /v1/tool/policy`). Typed calls come from `@distilled.cloud/litellm/tools`, generated from LiteLLM
**v1.103.0**; credentials and the family's other refusals are in [litellm.md](./litellm.md).

Everything marked "read" was read from the **live 1.103.0 container's source** on 2026-09-30 (no request was
sent to a proxy). No docs page for tool policy was found (docs.litellm.ai/docs/tool_policy and
/docs/proxy/tool_policy are both 404).

## ⛔ It does nothing until the `tool_policy` guardrail is configured

The rows are data. The only reader is `guardrails/guardrail_hooks/tool_policy/tool_policy_guardrail.py`, a
guardrail the proxy's **own config** must enable (its docstring: `guardrails: - guardrail_name: "tool_policy",
litellm_params: { guardrail: tool_policy, mode: post_call }`). Declaring a policy without it is an inert row,
not a control.

Measured 2026-09-30: `grep -c tool_policy /opt/homeflare/litellm-ct100/config.yaml` is **0**, so on the live
CT100 proxy these rows are not enforced today. Adding the guardrail is a config change this PR does not make.

## The distilled operations it uses

| step  | operation (`@distilled.cloud/litellm/tools`) | route                                  |
| ----- | -------------------------------------------- | -------------------------------------- |
| read  | `getToolV1ToolToolNameGet`                   | `GET /v1/tool/{tool_name:path}`        |
| write | `updateToolPolicyV1ToolPolicyPost`           | `POST /v1/tool/policy` (an **upsert**) |

## Example

```ts
import { LiteLLMToolPolicy, litellmProviders } from '@homeflare/alchemy/litellm';

// LiteLLM discovers tools as requests use them; a tool it has seen needs --adopt.
export class NoShell extends LiteLLMToolPolicy('NoShell', {
  toolName: 'estate_shell-run',
  inputPolicy: 'blocked',
}) {}

// Only what is declared is compared and sent.
export class Trusted extends LiteLLMToolPolicy('Trusted', {
  toolName: 'Memos_CF-search',
  inputPolicy: 'trusted',
  outputPolicy: 'trusted',
}) {}
```

Input: `untrusted` (default), `trusted` (blocked if the conversation holds output of an `untrusted` tool),
`blocked`. Output: `untrusted` (default), `trusted` (`TOOL_POLICY_OPTIONS`, `tool_management_endpoints.py`).

## Behaviour

| Concern     | Rule                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `toolName`. A different name is a different row: a `replace`, create-first, the old one retained.                                                                                                             |
| Create      | The write is an **upsert** on `tool_name` (`update_tool_policy`): a new row takes a sent field, else `untrusted`. So there is no separate create, and a tool never seen is created by it.                     |
| Adopt       | A tool LiteLLM already discovered has a live row with no state: `Unowned`, so it needs `--adopt` (a row at the defaults is adopted the same way).                                                             |
| Update      | Only the **declared** fields are compared and sent, and only those that differ. Declare at least one (LiteLLM answers 400 to neither).                                                                        |
| Removal     | `defaultRemovalPolicy: 'retain'`. There is **no delete route** for a tool row or its global policy, so `delete` **resets** the managed fields that are not already `untrusted`. It re-opens a `blocked` tool. |
| Write check | Reconcile reads back and fails (`LitellmRegistryNotConvergedError` / `…AbsentAfterWriteError`) if a declared field did not land.                                                                              |

⛔ **A "not found" is not proof of absence.** `db_get_tool` (`db/tool_registry_writer.py` lines 175-189)
catches every exception, logs it and returns `None`, which the route turns into a 404. A database error reads
exactly like a tool that was never seen. Nothing depends on it: the write is an upsert, so a wrong "absent"
ends in a write that succeeds, and the read back decides what the deploy reports.

## Team and key overrides are not modelled

`POST /v1/tool/policy` with a `team_id` or `key_hash` does not touch the tool row: it adds the tool to that
team's or key's `object_permission.blocked_tools` (`add_tool_to_object_permission_blocked`), the same list
`LiteLLM.Team` manages through `objectPermission.blockedTools`. Two resources writing one list would fight,
so this resource never sends either field. Block a tool for a team on the team, and for a key on the key.

## Refused before any request

A blank or padded `toolName`; a name the route table answers itself (`list`, `spend`, `policy/options`,
anything ending `/detail` or `/logs`: those routes are registered before `GET /v1/tool/{tool_name:path}`, so
such a tool could never be read back); neither policy declared; an `inputPolicy` or `outputPolicy` outside
the lists above (`dual_llm` exists in the type but is not an input or output value the route accepts).

## Licence gating (measured)

None in the routes: `tool_management_endpoints.py` and `db/tool_registry_writer.py` have no `premium_user`
reference (`grep -ci premium`: 0 in both). The `tool_policy` guardrail module has none either (0), so whether
a community proxy enforces it once configured is **UNVERIFIED** (nothing was run).

## Unmeasured at 1.103.0

No live proxy was contacted. The fake (`fake-tool-litellm.ts`) is built from the source; each choice is in its
header. The typed fix for this tag's undeclared 404 is a distilled patch, which belongs in the distilled clone
and is not part of this change.

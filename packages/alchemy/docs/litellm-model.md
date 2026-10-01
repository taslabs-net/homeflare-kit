# LiteLLM — `LiteLLM.Model`

One deployment row of LiteLLM's model registry (`/model/info`): an upstream model the proxy's
router serves under a group name. A group name can carry several deployments — that is LiteLLM's
load balancing — and this resource owns exactly one row of it. Typed calls come from
`@distilled.cloud/litellm/model_management`, generated from LiteLLM **v1.103.0**; the family's
credentials and other refusals in [litellm.md](./litellm.md).

## distilled operations it uses

Nothing hand-rolled: every call is one of these, through `model-operations.ts`.

| step   | operation (`@distilled.cloud/litellm/model_management`) | route                      |
| ------ | ------------------------------------------------------- | -------------------------- |
| list   | `getModelInfoV1ModelInfo`                               | `GET /model/info`          |
| read   | `getModelInfoV1ModelInfo` (`litellm_model_id` filter)   | `GET /model/info?id=…`     |
| create | `addNewModelModelNewPost`                               | `POST /model/new`          |
| update | `patchModelModelModelIdUpdatePatch`                     | `PATCH /model/{id}/update` |
| delete | `deleteModelModelDeletePost`                            | `POST /model/delete`       |

A missing id on the by-id read is HTTP 400 at v1.100.0 and v1.103.0 (`model_info_v1`), and the same
400 is also "no rights". Absence is a re-list that lacks the id, never the error text.

The list is the table and one GET answers a name, an id and absence. The by-id read is kept only
for the read-back of a row the list may not show yet (a create commits before the list refreshes)
— the same order `LiteLLM.MCPServer` keeps for its registry.

## Example

```ts
import { LiteLLMModel, litellmProviders } from '@homeflare/alchemy/litellm';

// An existing row, adopted by group name (needs --adopt). The id of the live row is adopted;
// omitting accessGroups declares "no groups", which clears them on adoption.
export class Grok extends LiteLLMModel('Grok', {
  modelName: 'grok',
  model: 'xai/grok-4.7',
  accessGroups: ['ct100-agents'],
}) {}

// A credential is the NAME of the environment variable the PROXY resolves in its own
// environment — never a value. A custom gateway goes through apiBase.
export class Canary extends LiteLLMModel('Canary', {
  modelName: 'canary',
  model: 'cloudflare/@cf/meta/llama-3.1-8b-instruct',
  apiBase: 'https://gateway.example.com/v1',
  apiKey: { fromEnv: 'CANARY_UPSTREAM_KEY' },
  mode: 'chat',
  baseModel: 'meta/llama-3.1-8b-instruct',
}) {}

// A pinned id adopts that exact row even when the name is shared by several deployments.
export class Pinned extends LiteLLMModel('Pinned', {
  id: 'model-abc123',
  modelName: 'grok',
  model: 'xai/grok-4.7',
}) {}
```

Then provide `litellmProviders()` alongside the stack's other providers.

## Behaviour

| Concern          | Rule                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adopt            | By `modelName` (the live row whose group name matches), or by `id` to pin one. A name matching more than one listed row is refused, never guessed at. A live row with no state needs `--adopt` — a same-named foreign row is never taken over silently (`LitellmModelForeignRowError`), and a config-file row (`db_model: false`) is refused even with `--adopt`.                     |
| default removal  | `retain` — removal takes the deployment out of its routing group for every key that reaches it; opt in with `.pipe(RemovalPolicy.destroy())`.                                                                                                                                                                                                                                         |
| rename           | A changed `modelName` without a pinned `id` is a new group: the old row survives under `retain`, the new group gets a fresh id. With a pinned `id` the same row is renamed in place.                                                                                                                                                                                                  |
| changed `id`     | The id is identity: a different declared id is a `replace`, create-first, old row retained.                                                                                                                                                                                                                                                                                           |
| credential       | `apiKey: { fromEnv: 'NAME' }` only — sent as LiteLLM's own `os.environ/NAME` reference, so the proxy resolves it in its own environment. Never a value (a value would land in Alchemy's unencrypted state).                                                                                                                                                                           |
| omitted `apiKey` | An adopted row is never blanked: omitting `apiKey` sends no `api_key`, and the live credential stays. Declaring one is what moves the row onto `os.environ/NAME`.                                                                                                                                                                                                                     |
| encrypted params | The v1.103.0 read answers `litellm_params` DECRYPTED but STRIPS `api_key` (measured), so the comparison is the visible fields the read returns plus `paramsSeal`, a digest of the DECLARED values — never a digest of the live row.                                                                                                                                                   |
| update scope     | Everything an existing row needs goes to ONE `PATCH /model/{id}/update` (`update_db_model` MERGES: sent keys land, the rest of the row survives). `POST /model/update` is never sent: v1.103.0 `update_model` REBUILDS `litellm_params` from the parsed request model and REPLACES the column, deleting a stored key the model does not declare (`extra_headers`, `weight`, `order`). |
| read-back        | Every write is read back: a field the proxy did not apply fails the deploy (`LitellmModelNotConvergedError`) instead of claiming success. A row that cannot be found after a write fails it too.                                                                                                                                                                                      |
| delete           | Idempotent by this resource, not by the vendor: a `BadRequest` re-lists, and only a genuinely-absent id counts as already deleted — a refused delete on a live row re-fails.                                                                                                                                                                                                          |
| list             | Empty: adoption is an explicit act (`--adopt`), and no ownership mark exists to filter by.                                                                                                                                                                                                                                                                                            |

A refused unpinned rename leaves a `replacing` row. Reverting the name finds this stack's own
still-serving deployment and refuses with `LitellmModelPriorGenerationError`: drop the state row
(`alchemy state rm`, which leaves the deployment) and deploy with `--adopt`. Do not delete the live
row — under `destroy()`, garbage collection deletes the old generation by that same id. A declared-id
replace whose read-back fails after `POST /model/new` resumes on the next deploy with `--adopt`.

## Refusals

A plan is refused, before any write, when the declaration:

- names `modelName` blank or carrying leading/trailing whitespace;
- declares `model` without a provider prefix (`xai/…`, `cloudflare/@cf/…`) — LiteLLM routes by it;
- declares `model` with the `openai/` prefix on a group whose name starts with `grok` — Grok is
  xAI's, declare `xai/…`;
- declares `apiBase` carrying userinfo, a fragment or a secret-looking query parameter;
- declares `apiKey` as anything but `{ fromEnv: 'NAME' }`, or names a blank variable.

## Not measured at v1.103.0, guarded instead

- Whether `/model/new` honours a supplied `model_info.id`: the answer is an untyped body, so the id
  asked for is the one tracked, and a read-back that cannot find it fails the deploy
  (`LitellmModelAbsentAfterWriteError`) rather than recording a row it cannot identify.
- What the real proxy answers for a duplicate create and a delete of a missing id: the fake's 400s
  there are its own choices. A PATCH of a missing id is HTTP 404 (`patch_model` at v1.103.0).
- The rest of `litellm_params` (rpm/tpm, timeouts, fallbacks, wildcard routing, …), cost fields on
  `model_info` beyond what the read returns, `teams`, and config-file rows (`db_model: false`) are
  not modelled on purpose. v1.103.0 fills every unset `litellm_params` field with its pydantic
  default before a params write (`updateLiteLLMParams`): a `None` default keeps the stored value,
  a non-`None` default overwrites it — so the PATCH sends `null` for `use_in_pass_through`,
  `use_litellm_proxy`, `use_xai_oauth`, `allow_client_keepalive_override` and
  `merge_reasoning_content_in_choices`, the five whose default is `false`. A bare matching adopt
  records `paramsSeal` locally and writes nothing; an adopt whose declaration also manages
  `api_key` or `api_base` PATCHes once, because those params never appear on a read and only a
  write can converge them.

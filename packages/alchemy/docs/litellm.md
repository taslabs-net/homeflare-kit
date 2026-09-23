# LiteLLM — `@homeflare/alchemy/litellm`

`LiteLLM.PassThroughEndpoint` declares one row of LiteLLM's `/config/pass_through_endpoint`
family: a route on the proxy that forwards requests to an upstream target, generated from
LiteLLM **1.100.0**'s own OpenAPI document (`codegen/manifest.json`'s `litellm-openapi` entry —
vendor code at tag `v1.100.0`, dumped by the vendor's own `gen-api-types.mjs`, cross-checked
byte-identically against the tag's committed `schema.d.ts`; NOT a live read, because the reference
proxy's `/openapi.json` could not be reached when this was walked — see the manifest entry's note).

## What is DB-backed and API-managed, versus config-file only

Measured at 1.100.0 (`schema.prisma`, `pass_through_endpoints.py`, and the mini's own
`settings.yaml` `store_model_in_db: true`):

| Family                                                                                                  | Managed by this resource?                       |
| ------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Pass-through endpoints                                                                                  | Yes — this package                              |
| Models, virtual keys, teams, credentials, access groups                                                 | DB-backed, API-managed, but no kit resource yet |
| `router_settings`, `litellm_settings`, `general_settings.master_key`/`database_url`/`store_model_in_db` | config-file only — read-only through the API    |
| A `config.yaml` pass-through entry (`is_from_config: true`)                                             | Read-only through this resource — see Refusals  |

## Credentials

Reads `LITELLM_PROXY_URL` and `LITELLM_PROXY_API_KEY` at call time — LiteLLM's own variable
names, the ones its `litellm` CLI reads (`litellm/proxy/client/cli/main.py` at the tag). No
default URL. The key must be LiteLLM's master key or another `PROXY_ADMIN` key:
`update_config_general_settings`, the function every mutation goes through, is `PROXY_ADMIN`
only. Never a prop — see [docs/credentials.md](./credentials.md) for the house rule.

## Refusals

This resource refuses a plan rather than writing something it cannot safely undo:

- **A path already held by an `is_from_config` row.** A DB row on the same path overrides the
  config file at runtime, so creating one would silently take over a route the operator declared
  in `config.yaml`. Change the config file instead, or pick a different path.
- **A DB row LiteLLM did not give an `id`.** LiteLLM identifies some pass-through endpoints by
  path alone, for backwards compatibility. Update and delete are both id-keyed, so this resource
  cannot address a row like that — it is refused rather than silently adopted into a lifecycle
  that cannot actually manage it.
- **A literal secret in a forwarded header.** `Authorization`, `x-api-key` and
  `cf-aig-authorization` must contain LiteLLM's own `os.environ/NAME` reference form
  (`set_env_variables_in_header`, `pass_through_endpoints.py` at the tag), never a literal value —
  a house rule (not a vendor one), because a missing variable on the proxy host would otherwise
  leave the literal string in the header with nothing in the API able to detect it.

A foreign DB row on the same path that LiteLLM DID give an id is `Unowned`: `read` finds it and
the plan needs `--adopt` before it is bound.

## Nullable fields: `timeout`, `methods`, `guardrails`

LiteLLM's update route merges the parsed body with `exclude_none` (measured at 1.100.0), so it
can never clear a field that is already set — sending neither `null` nor omitting it changes
anything already stored. Clearing one of these three fields is therefore planned as a
**replace**: delete the row, then create it again without the field. There is a brief window
with the route absent, and it exists because the alternative — create-before-delete — would put
two rows on the same path, which this resource never allows.

## The whole-field write, and why every mutation is serialised

Every pass-through endpoint lives in ONE `general_settings.pass_through_endpoints` list. Create,
update and delete are each a read-modify-write of that WHOLE list. `client.ts` wraps every
mutating call in a per-base-URL `Effect` semaphore, so two of THIS PROCESS's own calls never
race each other — two endpoints declared in the same deploy both survive.

⛔ **What the semaphore does not cover.** It serialises this package's own writes within one
process. It cannot serialise against the LiteLLM UI, another stack, or a second concurrent
`alchemy deploy` — the field has no ETag and no vendor-side locking. `reconcile` reads the row
back after every write rather than trusting the call that just returned, so a lost update is
visible on the NEXT plan (as drift) even though it cannot be prevented on this one.

## Example

Estate values — the account id, the gateway id, the upstream key's variable name — are never kit
constants; they are props your own stack supplies. Placeholders below, per the TypeSafe plugin's
`ai-gateway.md` reference (Cloudflare's `/accounts/{account_id}/ai/run`, a Workers-AI-scoped
Bearer token, `cf-aig-gateway-id` and `cf-aig-no-wholesale: true`):

```ts
import { LiteLLMPassThroughEndpoint, litellmProviders } from '@homeflare/alchemy/litellm';

export class AiGateway extends LiteLLMPassThroughEndpoint('AiGateway', {
  path: '/cloudflare-ai',
  target: 'https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/ai/run',
  headers: {
    Authorization: 'os.environ/CF_AI_GATEWAY_TOKEN',
    'cf-aig-gateway-id': '<GATEWAY_ID>',
    'cf-aig-no-wholesale': 'true',
  },
  timeout: 60,
}) {}
```

```ts
// …then provide `litellmProviders()` alongside the stack's other providers.
```

## Not covered

- **Models, virtual keys, teams, credentials, access groups.** DB-backed and API-managed at
  1.100.0, but no kit resource yet — deferred; see the unit's own trigger notes.
- **The Claude OAuth model/key/team slice.** Needs estate answers only Tim can give.
- **Runtime behaviour of a route forced into the schema for the dashboard.** The byte-identical
  cross-check proves the REQUEST/RESPONSE BODY SHAPES match the tag exactly. It does not prove
  every route the dashboard's generator forces into the schema (`include_in_schema = True`) is
  actually served the same way in production, or that the mini's own `config.yaml`/
  `general_settings` match what `schema.prisma`/`proxy_server.py` assume.
- **More than one uvicorn worker.** Pass-through routes register themselves on the worker that
  handled the registering request (`add_*_route` on `request.app`); with more than one worker,
  the others' routes are unmeasured by this package.

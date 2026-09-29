# LiteLLM — `LiteLLM.MCPServer`

One row of LiteLLM's `LiteLLM_MCPServerTable` (`/v1/mcp/server`): an upstream MCP server that the
proxy's gateway exposes to virtual keys and teams. Typed calls come from
`@distilled.cloud/litellm/mcp_management`, generated from LiteLLM **v1.103.0**; credentials and the
family's other refusals are in [litellm.md](./litellm.md).

## The distilled operations it uses

Nothing is hand-rolled: every call is one of these, through `mcp-server-operations.ts`.

| step   | operation (`@distilled.cloud/litellm/mcp_management`) | route                               |
| ------ | ----------------------------------------------------- | ----------------------------------- |
| list   | `fetchAllMcpServersV1McpServerGet`                    | `GET /v1/mcp/server`                |
| read   | `fetchMcpServerV1McpServerServerIdGet`                | `GET /v1/mcp/server/{server_id}`    |
| create | `addMcpServerV1McpServerPost`                         | `POST /v1/mcp/server`               |
| update | `editMcpServerV1McpServerPut`                         | `PUT /v1/mcp/server`                |
| delete | `removeMcpServerV1McpServerServerIdDelete`            | `DELETE /v1/mcp/server/{server_id}` |

Not used: the submission and approval flow, import, toolsets and the health check.

⛔ **The list is not the table.** Measured on the live 1.103.0 container (2026-09-29, source only):
`GET /v1/mcp/server` answers the proxy's **in-memory registry**. A reload fills it only from rows whose
approval status is null, active or approved, skips a row whose build throws, and the caller's key can
narrow it; `add_mcp_server` only logs a failed registry refresh after the row is committed. So a row
absent from the list can be live. The by-id read asks the **table** first (a 404 only when the table,
the registry and a lookup by name all miss), so it is what decides where the list cannot. It has side
effects (it registers the row and health-checks the upstream), so it runs only when the list misses.

## Example

```ts
import { LiteLLMMCPServer, litellmProviders } from '@homeflare/alchemy/litellm';

// An existing row, adopted by its name (needs --adopt), closed to every key except one group.
export class Docs extends LiteLLMMCPServer('Docs', {
  serverName: 'example_docs',
  url: 'https://mcp.example.com/mcp',
  transport: 'http',
  authType: 'none',
  mcpAccessGroups: ['example-knowledge'],
}) {}

// A static credential is the NAME of an environment variable in the deploying process. The tool
// whitelist is pinned by declaring `allowedTools`; leave it out to keep whatever the proxy holds.
export class Keyed extends LiteLLMMCPServer('Keyed', {
  serverName: 'example_keyed',
  url: 'https://keyed.example.com/sse',
  transport: 'sse',
  authType: 'bearer_token',
  authValue: { fromEnv: 'EXAMPLE_MCP_TOKEN' },
  allowedTools: ['search', 'fetch'],
}) {}
```

Then provide `litellmProviders()` alongside the stack's other providers.

## Behaviour

| Concern     | Rule                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | The live row whose `server_name` is `serverName`. `serverId` pins one row instead. Two rows with the same name are refused (`LitellmMcpServerAmbiguousNameError`).                                                                                                  |
| Adopt       | A live row with no state is `Unowned`; it needs `--adopt`. Adopting a row that already matches writes nothing. The plan says `adopted` even when reconcile then writes. A row the list lacks is adopted only by declaring its `serverId`.                           |
| Id          | A create asks for `serverId`, else a deterministic physical name. The id LiteLLM answers is the one recorded, so a proxy that issues its own id is still tracked.                                                                                                   |
| Replace     | Only a changed declared `serverId`, create-first. A changed `serverName` is an update: it renames the tools of every key that calls them.                                                                                                                           |
| Removal     | `defaultRemovalPolicy: 'retain'`. Opt in with `RemovalPolicy.destroy()`. A replace under `retain` leaves the old row live.                                                                                                                                          |
| Delete      | Always sends the DELETE (it acts on the table). If it fails, the failure is swallowed only when a by-id read of the table says the row is gone; a row still there, or a read that fails, re-raises the original error.                                              |
| Read        | The list first, then the table by id when the list lacks the row (the id it would use: recorded, declared, or the deterministic one). Copies no credential, header or environment value; a URL is redacted on the way in.                                           |
| Write check | Reconcile reads back (list, then table) and fails (`LitellmMcpServerNotConvergedError`) if a declared field did not land, or (`LitellmMcpServerAbsentAfterWriteError`) if the row is in neither. A created row the list does not show yet is recorded, not retried. |

## Access grants

`allowAllKeys` (default `false`) and `mcpAccessGroups` (default empty) are **always compared**, because
they decide which keys can reach a server: a live row that has them wider than declared is corrected.
Lists compare as sets.

⛔ **`allowedTools` is compared and sent only when declared, like `alias` and `description`.** An empty
list is the **open** state, not a closed one. Measured on the live 1.103.0 container (read-only, source
only): `server_applies_tool_allowlist` (`mcp_server/utils.py`) is "the `mcp_info` enforce flag, or a
non-empty `allowed_tools`", and `filter_tools_by_allowed_tools` (`server.py` lines 1692-1698) returns
every tool when that is false. `mcp_info` is not modelled here, so:

- Leave `allowedTools` out and the live whitelist is left exactly as it is: adopting a whitelisted row
  never widens it.
- Declare a list and it is authoritative: the live list becomes exactly that set.
- Declare `[]` only to say "no restriction". It is sent as it is.

⚠️ **The plan does not show an adopted row's write.** Alchemy's adoption branch plans `adopted` for a
live row with no state, whether or not reconcile then writes (`mcp-server-tools.test.ts` pins this), so
a corrected `allowAllKeys` or `mcpAccessGroups` on an adopted row appears in the plan only as `adopted`.
Later deploys of a row this stack owns plan `update`. `alias` and `description` are compared **only when
declared**, so adopting a row never clears text a person wrote.

⛔ **An update never lets LiteLLM default the alias.** Measured on the live container by running its own
`validate_and_normalize_mcp_server_payload` and `_prepare_mcp_server_data` on an edit body (no database):
a body with a `server_name` and no `alias` comes out with `alias = server_name`, and the alias **is
written**; a body with neither sends none. The alias is the tool prefix, so that would rename every tool
of a row aliased `search` (`search-*` to `estate_web-*`) for every key and seat. So an update sends
`server_name` only when it changes, and re-sends the live alias on a rename. A renamed row with no alias
gets the new name as its alias, LiteLLM's own default.

⚠️ **`description` cannot be written to a row whose `mcp_info` has a `description` key.** The list answers
`mcp_info.description` when the key exists (even as null), else the column, and this resource writes only
the column. Live, `linear` and `Memos_CF` have the key. A declared description that differs is refused
before any write (`LitellmMcpServerDescriptionShadowedError`); the same text, or none declared, is fine.

Team access is not here: the create and edit requests have no team field (`teams` exists only on the
row a read returns). Grant a team access from the team side (its `object_permission`).

## The credential: a name in, a seal out

⛔ **`authValue` is `{ fromEnv: 'NAME' }`, not a `Redacted` value.** Alchemy persists props and
attributes unencrypted, and `StateEncoding.ts` writes a `Redacted` value's inner string beside its tag
(measured on `alchemy@2.0.0-beta.79`), so a `Redacted` prop would sit in the state store as plaintext.
The variable is read from the deploying process at call time, held there as `Redacted` so a log line
prints `<redacted>`, and unwrapped in one place: the wire body. See
[provider-standard.md](./provider-standard.md) (S25) and `src/secrets/write-only.ts`.

Static types (`api_key`, `bearer_token`, `basic`, `authorization`, `token`) require `authValue`;
`none` and `oauth2` refuse it. LiteLLM is not assumed to return a credential, so a plan compares the
variable's current value with a **seal** (a salted scrypt digest) kept in the attributes:

| state     | when                                                      | plan                                       |
| --------- | --------------------------------------------------------- | ------------------------------------------ |
| `match`   | the variable is set and the seal was made from it         | no change                                  |
| `stale`   | the variable is set and there is no seal, or it disagrees | update: the declared credential is written |
| `unknown` | the variable is unset in this process                     | no change: a plan-only run is not drift    |
| `none`    | no credential is declared                                 | no change                                  |

A **create** needs the variable and fails naming it (`LitellmMcpServerCredentialEnvUnsetError`) if it
is unset or empty, and so does **any write that changes `authType` to a static type** (from `none`,
`oauth2` or another static type): before anything is sent. ⛔ Measured on the live 1.103.0 container
(`mcp_server/db.py` lines 1013-1014): an edit whose auth class differs from the stored one and that
sends no credential wipes the stored credential, and each static type is its own class. Sent without
the value, the row would end with none while the seal still matched the old value, so a later deploy
would be a no-op and the server would stay unauthenticated. Any other update sends the credential
whenever the process has it. Moving a server off a static type sends `credentials: null` and forgets
the seal. ⚠️ A seal of a guessable secret is still guessable: use a random token.

## Refused before any request

- A `-` in `serverName` or `alias` (LiteLLM's tool-prefix separator; it answers 400), a space or blank in
  `alias` (LiteLLM stores `_`, so the row would never match).
- A blank or padded `serverName`, `stdio` (it runs a command on the proxy host), and any auth type
  outside `none`, `oauth2` and the five static ones (the rest need credential fields not modelled).
- A URL with userinfo, a fragment, or a query parameter whose name looks like a credential (`token`,
  `api_key`, `secret`, `auth`, …). The URL is a prop and lands in state; put the secret in `authValue`.
- A blank entry in `allowedTools` or `mcpAccessGroups`.

## Not modelled

`stdio` and its `command`/`args`/`env`; `static_headers`, `extra_headers` and `env_vars` (a header or
variable can carry a secret); OAuth client registration and endpoints; `mcp_info`, tool renames, BYOK;
`timeout`, `max_concurrent_requests`, `available_on_public_internet`; `teams`. A row that uses them can
be adopted, and what is not declared is not sent. The edit route is a partial update at 1.103.0
(`mcp_server/db.py`, `exclude_unset=True`, read from the live container, not exercised), so an unsent
field keeps its stored value; measure it once on a scratch proxy before the first live update of an
adopted OAuth row (below).

## Unmeasured at 1.103.0

No live proxy was contacted. The fake (`fake-mcp-litellm.ts`) is built from the generated schema and
makes its own choices for each of these, except the clear-on-auth-change rule above, which it models
from the source; every one is guarded by the read back, so a wrong guess fails loudly rather than
reporting a converged row.

- Whether an empty list, a `false` or a `null` lands on an edit. (That `PUT /v1/mcp/server` is a
  partial update is read from the source, not called.)
- Whether a create honours a supplied `server_id`, and what a duplicate id or name answers.
- Whether the list redacts `credentials` (the resource copies none either way), whether it is paged or
  filtered for the master key, and whether it includes config-file servers, which cannot be edited.
- What a delete or an edit of a missing id answers on the wire. Read from the source: a delete of a
  missing row and a by-id read that misses everywhere are 404. `mcp_management` declares only
  `UnprocessableEntity`, and the distilled `patches/` that type 404 cover other tags, so the by-id read
  tests the SDK's `NotFound` class (`instanceof`), never a message. A distilled patch for this tag would
  type it; it belongs in the distilled clone.
- Whether LiteLLM normalises a URL. If it does, declare the URL the way the row returns it, or the
  read back names `url`.

## Before the first live adoption

Adopting a row that already matches is a no-op. Before an update reaches a live OAuth row, exercise the
edit route once against a scratch LiteLLM (a row with `static_headers` and OAuth endpoints, then an edit
of `allowAllKeys` alone) and record whether the other fields survive; the source says they do.

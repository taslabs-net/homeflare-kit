# LiteLLM — `LiteLLM.Key`

One virtual key of LiteLLM's `LiteLLM_VerificationToken` (`/key/*`), bound to a
[`LiteLLM.Budget`](./litellm-budget.md) tier, with its value **kept out of Alchemy state**. Typed
calls come from `@distilled.cloud/litellm/key_management`; credentials and the family's refusals are
in [litellm.md](./litellm.md). Read 2026-09-29 against `@homeflare/distilled-litellm@0.3.0`
(generated at LiteLLM **1.103.0**) and the 1.103.0 PyPI wheel's own source.

## The key value is write-only

Alchemy persists props **and** attributes unencrypted: a `Redacted` is tagged, not encrypted
(`State/StateEncoding.ts` writes the inner value beside the tag). So the key's value can be neither a
prop nor an attribute, and `LiteLLM.Key` uses the mechanism every other kit secret uses
(`src/secrets/write-only.ts`, the same one as the PBS webhook secret): the prop holds the **name** of
an environment variable.

```ts
import * as Effect from 'effect/Effect';
import { LiteLLMBudget, LiteLLMKey } from '@homeflare/alchemy/litellm';

export default Effect.gen(function* () {
  const tier = yield* LiteLLMBudget('Tier', { budgetId: 'hf-tier-seat', softBudget: 25 });
  yield* LiteLLMKey('Seat', {
    keyAlias: 'hf-seat-a',
    key: { fromEnv: 'HF_SEAT_A_KEY' }, // a random `sk-…` minted outside, e.g. in the vault
    budgetId: tier.budgetId, // an Output: Alchemy creates the tier first
    models: ['glm-5.3', 'gpt-oss-120b'],
    metadata: { seat: 'a' },
  });
});
```

Then provide `litellmProviders()` alongside the stack's other providers, as
[litellm.md](./litellm.md#example) shows.

| where the value is         | it is                                                                                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the declaration / state    | never: the state row holds `{ fromEnv: 'HF_SEAT_A_KEY' }`, the NAME                                                                                              |
| `diff`, `read`, a plan     | never read: a plan needs no secret and runs without the variable                                                                                                 |
| `/key/generate`'s body     | once, on create, unwrapped in `createBody` and nowhere else                                                                                                      |
| `/key/generate`'s response | `Redacted` (the SDK's `T.SensitiveValue`); compared with what was sent                                                                                           |
| an attribute, error or log | never: errors name the alias, the variable and the rule, not the value; a failed create is `LitellmKeyTransportError`, never the SDK's `HttpClientError` (below) |

★ **Why the value is minted outside and not by LiteLLM.** `/key/generate` does return the new key,
and the SDK hands it back `Redacted`. A resource has two places to put it: an attribute, which is
state in the clear, or nowhere, and LiteLLM never shows the plaintext again (only its hash). A key
minted and dropped is a row nobody can use. `/key/generate`'s own docstring supports a caller-chosen
value: "Must start with 'sk-' and be at least 16 characters long."

- **The value is create-only.** An existing key is never sent one, never compared with one. LiteLLM
  keeps `sha256(key)` (`hash_token`), so a check is possible, but `/key/update` cannot change a
  key's value (it drops `key` from the body) and `/key/regenerate` is an Enterprise feature.
  **Rotate by declaring a new alias**; a changed variable changes nothing on an existing key.
- **Adopting needs no value.** Omit `key` to manage an existing key's settings. A create with no `key`
  is refused (`LitellmKeyValueRequiredError`): it would mint a value nobody holds.
- **A malformed value is refused before any write**: not `sk-…`, under 16 characters (both LiteLLM's
  rules) or containing whitespace (the house's: a renderer's trailing newline would be sent as part of
  the value). The error names the variable and the rule, never the value.
- ⛔ **`DISTILLED_DEBUG_HTTP` refuses a create.** While it is set the SDK prints the first 400
  characters of every request and response body to stderr (`@distilled.cloud/core`, read 2026-09-29),
  and `/key/generate` carries the key in both. An update carries no value, so it is not refused.
- ⛔ **A create that fails on the wire does not carry the request.** `/key/generate`'s request body is
  `{"key":"sk-…"}`, and the SDK's `HttpClientError` holds its request, so `JSON.stringify`,
  `Bun.inspect` at depth or Effect's JSON logger printed the value from a dropped connection, from the
  deploy that failed over it, and from a defect (`protocol-rest.ts` reads a body with `Effect.orDie`).
  Measured 2026-09-29 with a synthetic key (`key-transport.test.ts`, each reading searched for the
  value). `generateKey` turns both into `LitellmKeyTransportError`: the alias and the reason's tag, no
  request, no cause. The key **may** exist afterwards (the answer can be lost after the write); the next
  deploy sees a live key with no state and takes it with `--adopt`, and one that did not land is created.
  The SDK's status errors (`BadRequest`, `Forbidden`, …) hold only the proxy's message and stay typed.
- ⚠️ **A proxy with the dashboard's `disable_custom_api_keys` setting on** answers 403 to any
  user-defined key (`_check_custom_key_allowed`). It surfaces as the SDK's `Forbidden`.
  UNVERIFIED whether the estate's proxy has it on.
- **A proxy that ignores the value** and mints its own would leave a key nobody can use, reported as
  a success. `/key/generate` echoes the key; a different one is deleted again and refused
  (`LitellmKeyValueNotHonouredError`). UNVERIFIED that any proxy does this.

## Props

| prop            | type                      | notes                                                                                    |
| --------------- | ------------------------- | ---------------------------------------------------------------------------------------- |
| `keyAlias`      | `string`                  | **Identity.** Non-empty, unique per proxy. Declare an existing key's alias to adopt it.  |
| `key`           | `{ fromEnv: string }`     | Write-only, create-only. Optional when the key already exists.                           |
| `budgetId`      | `string`                  | The tier. Pass `budget.budgetId` and Alchemy creates the tier first. Omitted = none.     |
| `models`        | `string[]`                | Omitted = `[]`, which LiteLLM reads as "all models". Compared order-insensitively.       |
| `allowedRoutes` | `string[]`                | Exact or wildcard routes. Omitted = `[]`.                                                |
| `teamId`        | `string`                  | Omitted = none.                                                                          |
| `metadata`      | `Record<string, unknown>` | Stored in state, so no secrets. `/key/update` **replaces** it wholesale: omitted = `{}`. |
| `duration`      | `string`                  | `'30d'`, `'12h'`, … from creation. Omitted = never expires. See below.                   |

Attributes: `keyAlias`, `budgetId`, `models`, `allowedRoutes`, `teamId`, `metadata`, `expires` (what
the row says, observed) and `duration` (see below). ⛔ There is no `key`, `token` or hash attribute.

## Behaviour

| Concern     | Rule                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity    | `keyAlias`. A different alias is **refused** (`LitellmKeyAliasChangedError`), not replaced: the new key would need the same value, and a retained old row still holds it.                        |
| Adopt       | A live key with the alias and no state is `Unowned`; needs `--adopt`. The apply re-checks it (`refuseTakeover`) for a create the planner could not probe.                                        |
| Removal     | `defaultRemovalPolicy: 'retain'`: deleting a key breaks whatever holds it. Opt in with `RemovalPolicy.destroy()`.                                                                                |
| Read        | `/key/list?key_alias=…&return_full_object=true`. Two rows under one alias are refused (`LitellmKeyAmbiguousAliasError`); the column is not unique in LiteLLM's schema.                           |
| Update      | `/key/update` by alias with **only the fields that differ**. A dropped `budget_id`/`team_id`/`duration` is an explicit `null`, a dropped list `[]`, dropped metadata `{}`.                       |
| Write check | Reconcile reads back; a field the row still differs on fails with `LitellmKeyFieldNotAppliedError`.                                                                                              |
| Delete      | Idempotent by the list: an absent alias writes nothing. The SDK's `KeyNotFound` (a lost race, a retried delete) re-lists and is swallowed only if the key is gone. Any other failure propagates. |
| Read errors | A 5xx on `/key/list` propagates typed. It is never read as "no such key" (which would go on to create one).                                                                                      |

⛔ **The declaration is the whole truth for these fields, so omitting one on an adopted key CHANGES
it.** Dropping `budgetId` clears the binding (and that tier's rate limits); dropping `models` or
`allowedRoutes` sends `[]`, which LiteLLM reads as **all models / no route restriction**, so the key
is WIDENED; dropping `teamId` detaches the team. Adopting a key means declaring what it has now. The
plan shows the `update` first, and `alchemy deploy --dry-run` shows it without writing.

### `duration`

The row carries `expires`, an absolute time, so a declared `'30d'` cannot be read back. State
remembers the duration this provider last wrote. Changing or dropping it plans an `update` that sends
`duration` (`null` = never expires; the 1.103.0 source sets `expires` from it). A key whose expiry
was set or cleared by hand while the declaration says otherwise plans an update too.
⚠️ **An adopted key remembers nothing**, so declaring a `duration` on one re-arms its expiry once,
from that deploy; afterwards a plan is quiet.

## Operations used, none guessed

Every call is `@distilled.cloud/litellm/key_management`'s own operation with its own request type,
through `throughFetch` (`operations.ts`); nothing is hand-rolled.

| operation                      | route                | used for                                                 |
| ------------------------------ | -------------------- | -------------------------------------------------------- |
| `listKeysKeyListGet`           | `GET /key/list`      | read by `key_alias`, `return_full_object: true`          |
| `generateKeyFnKeyGeneratePost` | `POST /key/generate` | create, with the user-defined `key`                      |
| `updateKeyFnKeyUpdatePost`     | `POST /key/update`   | merge patch, found by `key_alias` (no `key` in the body) |
| `deleteKeyFnKeyDeletePost`     | `POST /key/delete`   | delete by `key_aliases`                                  |

Not used: `/key/info` and `/v2/key/info` take the key or its hash, which an adopted key never has.

## Measured, and not

Measured 2026-09-29 in the 1.103.0 wheel's source (`litellm/proxy/management_endpoints/
key_management_endpoints.py`), not against a live proxy: `hash_token` is `sha256` hex; a duplicate
alias is 400 (`_enforce_unique_key_alias`, :7639); a user-defined key must start `sk-` and be 16+
characters (:1477-1490); `/key/update` applies `model_dump(exclude_unset=True)`, so an explicit `null`
clears a column and `key` is dropped (:2468-2469); `/key/delete` of an absent alias is **404** "No
keys found" (:4914) and of a forbidden one 403 (:4933); `/key/list` filters `key_alias` exactly, page
size at most 100 (:6376); `models` and `allowed_routes` are non-null `String[]` columns, hence `[]`
not `null` to clear.

★ **`/key/delete`'s 404 and 403 are typed by the SDK, as resource-specific tags.** The operation
declared 400 and 422 only, so both surfaced at runtime as core's status-mapped `NotFound`/`Forbidden`,
outside its error type. A distilled patch (`patches/key_management/delete_key_fn_key_delete_post.json`
in the distilled clone, byte-copied here) now types them as `KeyNotFound` (404, the message
`No keys found`) and `KeyDeleteForbidden` (403, `You are not authorized to delete this key`), each
matched on the status AND that phrase. `delete_key_fn` re-raises through `handle_exception_on_proxy`, so
the wire message is Python's `str(detail)`, `{'error': 'No keys found'}`, which the `includes` matcher
fits, as it fits a bare `detail`. `deleteKey` does `catchTag('KeyNotFound')`, then re-lists: the absence
proof is still the list, never the tag. A 404 without the phrase (a proxy in front) stays core's
`NotFound` and fails. UNVERIFIED against a live proxy: the wire shape is read from the wheel's source.
The tags ship with the next `@homeflare/distilled-litellm` release (its own changeset); the workspace copy has them now.

UNVERIFIED: that `/key/list?return_full_object=true` returns `budget_id` on a live 1.103.0 proxy (the
generated row type and the Prisma model both carry it; a miss fails the apply loudly as
`LitellmKeyFieldNotAppliedError`, never silently); the status of a `budget_id` naming no budget; a
retried `/key/generate` after a lost response (the SDK's default retry applies; the next deploy reads
the row). No live LiteLLM was contacted.

## Not modelled

Rate limits, `max_budget`/`soft_budget`, tags, guardrails, `allowed_passthrough_routes`,
`object_permission`, `blocked` and `spend`. The row read back has some of them, some it does not, and
a field a declaration cannot diff is a field it cannot own. Bind a `LiteLLM.Budget` for limits. Because
`/key/update` is a merge patch, a field this resource never sends is left as it is.

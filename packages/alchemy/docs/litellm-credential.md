# LiteLLM — `LiteLLM.Credential`

One row of LiteLLM's reusable credential table (`/credentials/*`): a named bag of values the
proxy stores **encrypted** and can bind to a deployment by `model_id`. Typed calls come from
`@distilled.cloud/litellm/credential_management` (generated from v1.103.0, the same schema this
resource's rules were read from); credentials and refusals are the family's, see
[litellm.md](./litellm.md).

## The values never live in a declaration

`credentialValues` is `Record<string, { fromEnv: 'NAME' }>`. Alchemy's state is unencrypted and
LiteLLM stores these literals encrypted in its own database (`credential_endpoints/endpoints.py`,
read from a 1.103.0 container), so the declaration holds only the variable's NAME; the
deploying process resolves the value at call time and the wire body carries the literal once.
A literal value in the props is refused at plan time, and so is a sensitive-keyed
`credentialInfo` entry — `credential_info` is stored and returned in the clear.

The reads hand the values back masked (`litellm_logging.py::_get_masked_values`: a
sensitive-keyed string answers `v[:2] + "****" + v[-2:]`, `*****` for a short one), so no value
is ever compared against or copied from the masked row (only value key names are retained): what was last written is remembered as
a salted scrypt seal (`valuesSeal`), and a rotated value is noticed by re-resolving and
re-sealing. A variable that is unset makes the state "cannot tell" — it never drifts a
plan-only environment. An info-only PATCH needs no value; a create, values PATCH or rewrite
demands every declared variable. A required rewrite refuses before DELETE if any is missing.

## Behaviour

| Concern     | Rule                                                                                                                                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `credentialName` (the table's unique column). A different declared name is a `replace`, `deleteFirst: false` — the old row survives.                                                                                                              |
| Adopt       | A live row with the name and no state is `Unowned`; needs `--adopt`. The full intended info and value-key maps are authoritative, including undeclared live keys. Resolvable values are stamped and sealed; removal requires all declared values. |
| Removal     | `defaultRemovalPolicy: 'retain'` — a deployment's `model_id` may reference the row. Opt in with `RemovalPolicy.destroy()`. Delete is idempotent (`NotFound` is already-absent).                                                                   |
| Read        | `GET /credentials/by_name/{name}` — the proxy's in-memory list, not the table. A row committed to the database but not loaded in memory reads as absent; a create for it answers `409`, which fails the deploy loudly.                            |
| Update      | PATCH changes values/info; DELETE + POST removes value or info keys. The regenerated SDK sends the required `credential_name` in both path and body.                                                                                              |
| Write check | Reconcile reads back; unapplied info or remaining removed key names fail with `LitellmCredentialNotConvergedError`. Values and masked fragments never enter state.                                                                                |

## PATCH and removal

Measured in LiteLLM 1.103.0 `proxy/credential_endpoints/endpoints.py:312,384`: PATCH merges
`credential_values` by key in both database and memory. It cannot remove a value key. The
by-name read exposes key names even when values are masked, so removed names trigger a rewrite.

`credential_info` differs: nonempty PATCH info normally **replaces** the database map
(`:314–319`, except when the old map contains a literal `credential_info` key); empty info
leaves it unchanged. In-memory info only merges (`:385–387`), retaining old keys until restart.
Every PATCH sends the full intended info map. **The declaration owns the complete map**, with
omission meaning `{}`: undeclared live info keys, including on adoption, are removed by rewrite
so both stores agree. Sensitive info values are withheld; only their names are retained.

Reconcile refuses invalid declarations and `DISTILLED_DEBUG_HTTP` at entry, rechecks ownership,
and demands all values needed for a write before any DELETE. Debug logging could print request
or response values; plan-time reads refuse debug logging too. Transport failures from value-bearing POST/PATCH become a typed
`LitellmCredentialTransportError` containing the name and reason tag, no request or cause.
A failed PATCH leaves the row in place. A rewrite is still non-atomic: a failed POST after a
successful DELETE can leave no row. No live proxy was contacted for these regression tests.

## Not modelled

`model_id` (copying a deployment's values into a credential) — nothing in the estate declares
one yet; add it with a measured read of the copy semantics.

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
sensitive-keyed string answers `v[:2] + "****" + v[-2:]`, `*****` for a short one), so nothing
is ever compared against or copied from the masked row: what was last written is remembered as
a salted scrypt seal (`valuesSeal`), and a rotated value is noticed by re-resolving and
re-sealing. A variable that is unset makes the state "cannot tell" — it never drifts a
plan-only environment, and it never blanks half a row: a write demands every declared
variable, because the rewrite is whole-row.

## Behaviour

| Concern     | Rule                                                                                                                                                                                                                                                            |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity    | `credentialName` (the table's unique column). A different declared name is a `replace`, `deleteFirst: false` — the old row survives.                                                                                                                            |
| Adopt       | A live row with the name and no state is `Unowned`; needs `--adopt`. Adopted with the values resolvable, the declared values are stamped and sealed; with them unset, nothing is written.                                                                       |
| Removal     | `defaultRemovalPolicy: 'retain'` — a deployment's `model_id` may reference the row. Opt in with `RemovalPolicy.destroy()`. Delete is idempotent (`NotFound` is already-absent).                                                                                 |
| Read        | `GET /credentials/by_name/{name}` — the proxy's in-memory list, not the table. A row committed to the database but not loaded in memory reads as absent; a create for it answers `409`, which fails the deploy loudly.                                          |
| Update      | ⚠️ DELETE + POST, never PATCH: the SDK's typed PATCH operation is wire-broken (its body omits `credential_name`, which the vendor's `UpdateCredentialItem` requires), measured with a stub fetch against the SDK. The typed fix belongs in the distilled clone. |
| Write check | Reconcile reads back; a `credential_info` key the write did not apply fails with `LitellmCredentialNotConvergedError`. Undeclared live info keys are ignored (the vendor's merge can never remove a key).                                                       |

## Not modelled

`model_id` (copying a deployment's values into a credential) — nothing in the estate declares
one yet; add it with a measured read of the copy semantics. A live `credential_info` key the
declaration does not name is unmodelled and never drift, because the vendor's update merge
assigns keys and can never remove them (read from the 1.103.0 source).

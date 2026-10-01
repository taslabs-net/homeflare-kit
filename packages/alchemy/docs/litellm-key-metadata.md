# LiteLLM — `LiteLLM.Key` metadata

How [`LiteLLM.Key`](./litellm-key.md) compares and writes a key's `metadata`, and what it never holds.
Read 2026-09-29 in the LiteLLM **1.103.0** PyPI wheel's source (`litellm/proxy/…`), not against a live
proxy. The code is `src/litellm/key-metadata.ts`; its header carries the same reasoning.

## Why `metadata` is not the declarer's alone

LiteLLM stores many per-key settings **inside** the `metadata` JSON column:

- `LiteLLM_ManagementEndpoint_MetadataFields` and `..._Premium` (`_types.py:4821-4853`): `model_rpm_limit`,
  `model_tpm_limit`, `enforced_params`, `end_user_budget_id`, `guardrails`, `policies`, `tags`, `prompts`,
  `logging`, `secret_manager_settings`, `allowed_passthrough_routes`, and others.
- `/key/generate` folds them in through `metadata_json_with_limits` (`key_management_endpoints.py:4429-4457`).
- `/key/update` **replaces** the column with the `metadata` it is sent (`prepare_metadata_fields`, :2312-2359).
  When `metadata` is not sent it keeps the existing one (:2318-2319). Only `service_account_id` is
  preserved across a replacement (`LiteLLM_Reserved_Metadata_Fields`, `_types.py:4857`; :2323-2336).

A body that carried only the declared keys therefore strips the key's guardrails, per-model caps and
passthrough allowlist, and the deploy reports success. Measured over the test fake, which replaces the
column the same way: an adopted key with `{ seat: 'a', guardrails: [...], model_rpm_limit: {...} }` and a
declaration of `metadata: { seat: 'b' }` lost both before this merge (`key-metadata.test.ts`).

## The merge

| Declaration                | Compared                                        | Sent (only when a declared key differs)        |
| -------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| `metadata` omitted         | nothing                                         | nothing                                        |
| `metadata: { seat: 'a' }`  | the live `seat` against `'a'`                   | every live key, with `seat` set as declared    |
| `metadata: { seat: null }` | the live `seat` against `null` (absent differs) | every live key, with `seat: null`; quiet after |

A key you stop declaring is **carried, never removed**: leaving it out does not clear it, declare it
`null`. The alternative, a list of the keys LiteLLM owns to carry while clearing the rest, was not
taken: the list is per-version, a key LiteLLM adds next release would be stripped until it is updated,
and this way fails safe on a live credential. The scope is top-level keys, as LiteLLM reads them.

## Callback credentials are never held

`logging`, `callback_settings` and `secret_manager_settings` (`common_utils/callback_utils.py:51`,
`_CALLBACK_CONFIG_SLOTS`) carry `callback_vars`: an observability platform's secret keys. LiteLLM
encrypts them at rest (`encrypt_callback_vars`, :716), but a legacy row's are plaintext ("Legacy
plaintext rows pass through unchanged", `decrypt_callback_vars`, :725-731), and Alchemy persists
attributes unencrypted. So:

| What                                        | What this resource does                                                                                                                                                  |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A row with one of the slots (read, adopt)   | Drops the slot from `attributes.metadata`; keeps only its **name** in `attributes.withheld`.                                                                             |
| A declaration whose `metadata` names a slot | Refused (`LitellmKeyCallbackMetadataDeclaredError`): stored encrypted, it would never read back equal and every deploy would fail with `LitellmKeyFieldNotAppliedError`. |
| A metadata write onto a key that has a slot | Refused (`LitellmKeyCallbackMetadataLiveError`): the resource never read the slot, so the update could not carry it, and LiteLLM would drop it.                          |
| A write that touches no `metadata`          | Goes ahead: the update body has no `metadata`, and the column is left as it is.                                                                                          |

Configure key logging in LiteLLM itself. ⚠️ The raw slot still crosses the wire in `/key/list`'s answer
(as every read of that row does), so `DISTILLED_DEBUG_HTTP`, which prints response bodies, would show a
legacy plaintext one on a read; it is refused only for a create, where the request carries the key.
UNVERIFIED: whether `/key/list` returns the stored (encrypted) or the decrypted form of `callback_vars`;
either is dropped before it reaches an attribute.

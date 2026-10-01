/**
 * `LiteLLM.Key`'s `metadata` column: what is compared, what is sent, and what is never held.
 * Pure, so it is testable without a server.
 *
 * ⛔ `metadata` IS NOT ONLY THE DECLARER'S. LiteLLM 1.103 keeps a key's guardrails, policies, tags,
 *   prompts, per-model RPM/TPM caps, `enforced_params`, `allowed_passthrough_routes`,
 *   `end_user_budget_id` and more INSIDE it: they are `LiteLLM_ManagementEndpoint_MetadataFields`
 *   and `..._Premium` (`proxy/_types.py:4821-4853`), folded in on create by
 *   `metadata_json_with_limits` (`key_management_endpoints.py:4429`) and on update by
 *   `prepare_metadata_fields` (:2312). And `/key/update` REPLACES the column with the `metadata` it is
 *   sent: only `service_account_id`, the one reserved field, survives an omission (:2323-2336). A
 *   body carrying just the declared keys therefore strips every one of those from a live credential,
 *   and the deploy reports success. Measured over the fake, which replaces the column the same way
 *   (key.test.ts, "metadata is a merge").
 * ★ SO `metadata` IS A MERGE, AT THE TOP-LEVEL KEY. A declaration COMPARES and WRITES only the keys it
 *   names; a live key it does not name is CARRIED into the update body unchanged, never dropped. The
 *   alternative, a list of the keys LiteLLM owns to carry and clear the rest, was not taken: the list
 *   is per-version (a key LiteLLM adds next release would be stripped until it is updated here),
 *   and this way fails safe. The cost: a key cannot be removed by leaving it out. Declare it `null`.
 * ⛔ THREE SLOTS ARE NEVER HELD, READ OR WRITTEN: `logging`, `callback_settings` and
 *   `secret_manager_settings` (`common_utils/callback_utils.py:51`, `_CALLBACK_CONFIG_SLOTS`). They
 *   carry `callback_vars`, an observability platform's secret keys. LiteLLM encrypts them at rest
 *   (`encrypt_callback_vars`, :716) but a legacy row's are plaintext ("pass through unchanged",
 *   :725-731), and Alchemy persists attributes unencrypted. So a row's slots are dropped from
 *   `KeyAttributes.metadata` and only their NAMES are kept (`withheld`); a declaration that names
 *   one is refused, since it would be stored encrypted and so never read back equal (a deploy that
 *   failed on every run); and a metadata write on a key that HAS one is refused, since this resource
 *   cannot carry what it never read. Configure key logging in LiteLLM itself.
 * ⚠️ TOP-LEVEL KEYS ONLY, as LiteLLM reads them: `_transform_callback_vars` looks at `metadata["logging"]`
 *   and no deeper.
 */
import { deepEqual } from 'alchemy/Diff';

export type Metadata = Readonly<Record<string, unknown>>;

/** The slots that carry callback credentials: never in attributes, never declared, never written. */
export const CALLBACK_SLOTS = ['callback_settings', 'logging', 'secret_manager_settings'] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The callback slots `metadata` names, sorted (`CALLBACK_SLOTS` is). */
export const callbackSlotsIn = (metadata: Metadata | undefined): readonly string[] =>
  metadata === undefined ? [] : CALLBACK_SLOTS.filter((slot) => Object.hasOwn(metadata, slot));

/**
 * A row's `metadata` as attributes hold it: everything but the callback slots, whose NAMES are
 * returned beside it (`withheld`) so a write knows it could not carry them.
 */
export const splitMetadata = (
  raw: unknown,
): { readonly metadata: Record<string, unknown>; readonly withheld: readonly string[] } => {
  if (!isObject(raw)) return { metadata: {}, withheld: [] };
  const withheld = callbackSlotsIn(raw);
  return {
    metadata: Object.fromEntries(Object.entries(raw).filter(([name]) => !withheld.includes(name))),
    withheld,
  };
};

/**
 * Whether a key the declaration names differs from the live row. An absent live key differs from any
 * declared value, `null` included (`deepEqual` tells `undefined` from `null`), so `{ seat: null }`
 * writes a `null` once and is quiet after.
 */
export const metadataDiffers = (live: Metadata, declared: Metadata | undefined): boolean =>
  declared !== undefined &&
  Object.entries(declared).some(([name, value]) => !deepEqual(live[name], value));

/** The body's `metadata`: every live key carried, the declared ones on top. */
export const mergedMetadata = (live: Metadata, declared: Metadata | undefined): Metadata => ({
  ...live,
  ...declared,
});

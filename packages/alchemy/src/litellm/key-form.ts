/**
 * Props, attributes, wire bodies and comparison for `LiteLLM.Key`, testable without a server.
 *
 * ⛔ THERE IS NO SECRET IN THIS FILE'S OUTPUT. `KeyAttributes` has no `key`, no `token` and no hash:
 *   `/key/list` rows carry `token` (LiteLLM's hash of the key) and `toAttributes` drops it, because
 *   attributes are persisted unencrypted (key-secret.ts). The value is unwrapped in `createBody`, at
 *   the last moment before the wire. The callback slots of `metadata` are dropped too (key-metadata.ts).
 * ★ THE ROW IS READ THROUGH `/key/list?key_alias=…&return_full_object=true`. Measured 2026-09-28
 *   (litellm-key-access): a bare list and `get_key` come back with `models: []` for keys whose real
 *   allowlist lives in the full object. The generated `UserAPIKeyAuth` row declares every column
 *   compared here (`budget_id`, `models`, `allowed_routes`, `team_id`, `metadata`, `expires`).
 * ⛔ A DECLARATION MANAGES ONLY WHAT IT NAMES. An omitted `budgetId`, `models`, `allowedRoutes`,
 *   `teamId` or `duration` is neither compared nor sent, so a live value stays. Reading omission as
 *   "clear it" FAILS OPEN on a credential: `[]` is "all models" and "no route restriction" to
 *   LiteLLM, and no budget drops the tier's limits. On an adopted key (whose plan says `adopted`, never
 *   what the apply will write, and which `--adopt` given for another resource takes over too) that
 *   would widen a live key without the plan ever showing an `update`. Clearing is an explicit
 *   declaration: `models: []`, `allowedRoutes: []`, `budgetId: null`, `teamId: null`, `duration: null`.
 *   `/key/update` is a merge patch for the COLUMNS (its docstring), so an unsent one is left as it is.
 * ⛔ `metadata` IS A MERGE, NOT A COLUMN OF THE DECLARER'S: LiteLLM keeps guardrails, per-model limits
 *   and more inside it, and `/key/update` replaces it wholesale. See key-metadata.ts.
 * ⚠️ NOT MODELLED, so a declaration of them could never be diffed: `max_budget`, `soft_budget`,
 *   `object_permission`, `blocked`, `spend`, and the top-level rate limits. Bind a `LiteLLM.Budget`
 *   for limits. The ones that live in `metadata` (guardrails, tags, `model_rpm_limit`, …) are left
 *   alone by the merge, and can be declared as `metadata` keys.
 */
import type * as keys from '@distilled.cloud/litellm/key_management';
import * as Redacted from 'effect/Redacted';
import type { FromEnv } from '../secrets/write-only.ts';
import { type Metadata, mergedMetadata, metadataDiffers, splitMetadata } from './key-metadata.ts';

export interface KeyProps {
  /** The alias LiteLLM knows the key by: its identity, unique per proxy. Declare an existing key's alias to adopt it. */
  readonly keyAlias: string;
  /**
   * The key's VALUE, by the NAME of the environment variable holding it (`{ fromEnv: 'SEAT_KEY' }`).
   * Write-only and create-only: required to create the key, never stored, never compared with a
   * live row. Omit it to manage an existing key's settings without ever holding its value.
   */
  readonly key?: FromEnv;
  /**
   * The `LiteLLM.Budget` tier the key binds to (`budget.budgetId`, so the tier is created first).
   * Omitted = not managed, a live binding stays. `null` = unbind, which drops the tier's limits.
   */
  readonly budgetId?: string | null;
  /**
   * Model names the key may call. Omitted = not managed, a live scope stays (a NEW key then starts
   * with LiteLLM's default). `[]` = ALL models, LiteLLM's reading: declared on a scoped key it WIDENS it.
   */
  readonly models?: readonly string[];
  /**
   * Routes the key may call, exact or wildcard (`/chat/completions`, `/v1/*`). Omitted = not
   * managed. `[]` = no route restriction: declared on a restricted key it WIDENS it.
   */
  readonly allowedRoutes?: readonly string[];
  /** The team the key belongs to. Omitted = not managed. `null` = detach. */
  readonly teamId?: string | null;
  /**
   * The `metadata` keys this declaration manages, a MERGE (key-metadata.ts): other live keys are
   * carried, never removed, and a key is cleared by declaring it `null`. Stored in state, so no
   * secrets. `logging`, `callback_settings` and `secret_manager_settings` are refused.
   */
  readonly metadata?: Metadata;
  /**
   * Validity from creation: `'30s'`, `'30m'`, `'30h'`, `'30d'`. Omitted = not managed (a live expiry
   * stays; a new key never expires). `null` = never expires, which clears a live expiry.
   */
  readonly duration?: string | null;
}

export interface KeyAttributes {
  readonly keyAlias: string;
  readonly budgetId: string | null;
  readonly models: readonly string[];
  readonly allowedRoutes: readonly string[];
  readonly teamId: string | null;
  /** The row's `metadata` WITHOUT the callback slots (`withheld`): those carry secret keys and state is unencrypted. */
  readonly metadata: Metadata;
  /**
   * The `duration` this provider last WROTE. The row carries only `expires`, an absolute time, so
   * the declared duration cannot be read back; state remembers it. `null` for an adopted row.
   */
  readonly duration: string | null;
  /** When the key stops authenticating, as the row says. Observed, never declared. */
  readonly expires: string | null;
  /**
   * The NAMES of the `metadata` callback slots the row has and this resource never reads. A metadata
   * write is refused while any is present: `/key/update` replaces the column and could not carry them.
   */
  readonly withheld: readonly string[];
}

/** Order-insensitive: LiteLLM does not promise the order a list comes back in. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
};

/**
 * Whether the expiry differs from the DECLARED `duration` (`null` = never expires): the remembered
 * duration is not the declared one, or the row has (no) expiry where the declaration wants (none) —
 * someone cleared or set it by hand.
 * ⚠️ AN ADOPTED ROW REMEMBERS NOTHING, so declaring a `duration` on one re-arms its expiry once,
 *   from that deploy; after it the duration is remembered and a plan is quiet.
 */
const expiryDiffers = (live: KeyAttributes, wanted: string | null): boolean =>
  live.duration !== wanted || (wanted === null) !== (live.expires === null);

/**
 * Wire names of the fields the declaration NAMES where the live row disagrees. An omitted prop is
 * never here (the header's "manages only what it names"), so nothing omitted is ever written.
 */
export const differing = (live: KeyAttributes, props: KeyProps): readonly string[] => {
  const out: string[] = [];
  if (props.budgetId !== undefined && live.budgetId !== props.budgetId) out.push('budget_id');
  if (props.models !== undefined && !sameSet(live.models, props.models)) out.push('models');
  if (props.allowedRoutes !== undefined && !sameSet(live.allowedRoutes, props.allowedRoutes)) {
    out.push('allowed_routes');
  }
  if (props.teamId !== undefined && live.teamId !== props.teamId) out.push('team_id');
  if (metadataDiffers(live.metadata, props.metadata)) out.push('metadata');
  if (props.duration !== undefined && expiryDiffers(live, props.duration)) out.push('duration');
  return out;
};

/**
 * Create body: only what is declared, plus the value.
 * ⛔ `Redacted.value` IS CALLED HERE, TO SEND, AND IN key-secret.ts's `echoes`, TO COMPARE — nowhere else.
 */
export const createBody = (
  props: KeyProps,
  secret: Redacted.Redacted<string>,
): keys.GenerateKeyFnKeyGeneratePostRequest => {
  const body: keys.GenerateKeyFnKeyGeneratePostRequest = {
    key: Redacted.value(secret),
    key_alias: props.keyAlias,
  };
  // ★ A DECLARED `null` (unbind, detach, never expires) IS NOT SENT: a new key has nothing to clear.
  if (typeof props.budgetId === 'string') body.budget_id = props.budgetId;
  if (props.models !== undefined) body.models = [...props.models];
  if (props.allowedRoutes !== undefined) body.allowed_routes = [...props.allowedRoutes];
  if (typeof props.teamId === 'string') body.team_id = props.teamId;
  if (props.metadata !== undefined) body.metadata = { ...props.metadata };
  if (typeof props.duration === 'string') body.duration = props.duration;
  return body;
};

/**
 * Update body: the alias (which finds the key, `key` omitted) and ONLY the declared fields that
 * differ, each as the declaration wants it — a declared `null` on `budget_id`/`team_id`/`duration`
 * as an explicit `null` (a key column, which "an explicit null clears"), a declared `[]` as `[]`.
 * ★ `metadata` CARRIES EVERY LIVE KEY with the declared ones on top, because `/key/update` replaces
 *   the column (key-metadata.ts). The caller has refused a key with `withheld` slots by now.
 * ⛔ NEVER CARRIES `key`: an update must not be able to change which value authenticates.
 */
export const updateBody = (
  props: KeyProps,
  live: KeyAttributes,
): keys.UpdateKeyFnKeyUpdatePostRequest => {
  const body: keys.UpdateKeyFnKeyUpdatePostRequest = { key_alias: live.keyAlias };
  for (const field of differing(live, props)) {
    if (field === 'budget_id') body.budget_id = props.budgetId ?? null;
    if (field === 'models') body.models = [...(props.models ?? [])];
    if (field === 'allowed_routes') body.allowed_routes = [...(props.allowedRoutes ?? [])];
    if (field === 'team_id') body.team_id = props.teamId ?? null;
    if (field === 'metadata') body.metadata = { ...mergedMetadata(live.metadata, props.metadata) };
    if (field === 'duration') body.duration = props.duration ?? null;
  }
  return body;
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * One row of `/key/list?return_full_object=true`. The row's `token` (LiteLLM's hash of the key), the
 * `metadata` callback slots (only their names stay, as `withheld`), and every other column not named
 * in `KeyAttributes`, are dropped here on purpose.
 */
export const toAttributes = (row: Record<string, unknown>): KeyAttributes => {
  const { metadata, withheld } = splitMetadata(row['metadata']);
  return {
    allowedRoutes: strings(row['allowed_routes']),
    budgetId: stringOrNull(row['budget_id']),
    duration: null,
    expires: stringOrNull(row['expires']),
    keyAlias: String(row['key_alias']),
    metadata,
    models: strings(row['models']),
    teamId: stringOrNull(row['team_id']),
    withheld,
  };
};

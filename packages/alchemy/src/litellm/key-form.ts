/**
 * Props, attributes, wire bodies and comparison for `LiteLLM.Key`, testable without a server.
 *
 * ⛔ THERE IS NO SECRET IN THIS FILE'S OUTPUT. `KeyAttributes` has no `key`, no `token` and no hash:
 *   `/key/list` rows carry `token` (LiteLLM's hash of the key) and `toAttributes` drops it, because
 *   attributes are persisted unencrypted (key-secret.ts). The value is unwrapped in `createBody`, at
 *   the last moment before the wire.
 * ★ THE ROW IS READ THROUGH `/key/list?key_alias=…&return_full_object=true`. Measured 2026-09-28
 *   (litellm-key-access): a bare list and `get_key` come back with `models: []` for keys whose real
 *   allowlist lives in the full object. The generated `UserAPIKeyAuth` row declares every column
 *   compared here (`budget_id`, `models`, `allowed_routes`, `team_id`, `metadata`, `expires`).
 * ⚠️ NOT MODELLED, so a declaration of them could never be diffed: rate limits, `max_budget`,
 *   `soft_budget`, tags, guardrails, `allowed_passthrough_routes` (not on the row type),
 *   `object_permission`, `blocked`, `spend`. Bind a `LiteLLM.Budget` for limits; add the rest once a
 *   read that returns them is measured. `/key/update` is a merge patch (its docstring), so a field
 *   this file never sends is left exactly as it is.
 */
import type * as keys from '@distilled.cloud/litellm/key_management';
import { deepEqual } from 'alchemy/Diff';
import * as Redacted from 'effect/Redacted';
import type { FromEnv } from '../secrets/write-only.ts';

export interface KeyProps {
  /** The alias LiteLLM knows the key by: its identity, unique per proxy. Declare an existing key's alias to adopt it. */
  readonly keyAlias: string;
  /**
   * The key's VALUE, by the NAME of the environment variable holding it (`{ fromEnv: 'SEAT_KEY' }`).
   * Write-only and create-only: required to create the key, never stored, never compared with a
   * live row. Omit it to manage an existing key's settings without ever holding its value.
   */
  readonly key?: FromEnv;
  /** The `LiteLLM.Budget` tier the key binds to (`budget.budgetId`, so the tier is created first). Omitted = unbound. */
  readonly budgetId?: string;
  /** Model names the key may call. Omitted = `[]`, which LiteLLM reads as "all models": on an adopted key that WIDENS it. */
  readonly models?: readonly string[];
  /** Routes the key may call, exact or wildcard (`/chat/completions`, `/v1/*`). Omitted = `[]`. */
  readonly allowedRoutes?: readonly string[];
  /** The team the key belongs to. Omitted = none. */
  readonly teamId?: string;
  /** Key metadata. `/key/update` REPLACES it wholesale, so omitted means `{}`. */
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Validity from creation: `'30s'`, `'30m'`, `'30h'`, `'30d'`. Omitted = never expires. */
  readonly duration?: string;
}

export interface KeyAttributes {
  readonly keyAlias: string;
  readonly budgetId: string | null;
  readonly models: readonly string[];
  readonly allowedRoutes: readonly string[];
  readonly teamId: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  /**
   * The `duration` this provider last WROTE. The row carries only `expires`, an absolute time, so
   * the declared duration cannot be read back; state remembers it. `null` for an adopted row.
   */
  readonly duration: string | null;
  /** When the key stops authenticating, as the row says. Observed, never declared. */
  readonly expires: string | null;
}

/** Order-insensitive: LiteLLM does not promise the order a list comes back in. */
const sameSet = (a: readonly string[], b: readonly string[]): boolean => {
  const left = [...a].sort();
  const right = [...b].sort();
  return left.length === right.length && left.every((value, i) => value === right[i]);
};

/**
 * Whether the expiry differs from the declaration: the remembered duration is not the declared one,
 * or the row has (no) expiry where the declaration wants (none) — someone cleared or set it by hand.
 * ⚠️ AN ADOPTED ROW REMEMBERS NOTHING, so declaring a `duration` on one re-arms its expiry once,
 *   from that deploy; after it the duration is remembered and a plan is quiet.
 */
const expiryDiffers = (live: KeyAttributes, props: KeyProps): boolean => {
  const wanted = props.duration ?? null;
  return live.duration !== wanted || (wanted === null) !== (live.expires === null);
};

/** Wire names of the fields where the live row and the declaration disagree. */
export const differing = (live: KeyAttributes, props: KeyProps): readonly string[] => {
  const out: string[] = [];
  if (live.budgetId !== (props.budgetId ?? null)) out.push('budget_id');
  if (!sameSet(live.models, props.models ?? [])) out.push('models');
  if (!sameSet(live.allowedRoutes, props.allowedRoutes ?? [])) out.push('allowed_routes');
  if (live.teamId !== (props.teamId ?? null)) out.push('team_id');
  if (!deepEqual(live.metadata, props.metadata ?? {})) out.push('metadata');
  if (expiryDiffers(live, props)) out.push('duration');
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
  if (props.budgetId !== undefined) body.budget_id = props.budgetId;
  if (props.models !== undefined) body.models = [...props.models];
  if (props.allowedRoutes !== undefined) body.allowed_routes = [...props.allowedRoutes];
  if (props.teamId !== undefined) body.team_id = props.teamId;
  if (props.metadata !== undefined) body.metadata = { ...props.metadata };
  if (props.duration !== undefined) body.duration = props.duration;
  return body;
};

/**
 * Update body: the alias (which finds the key, `key` omitted) and ONLY the fields that differ, each
 * as the declaration wants it — a dropped `budget_id`/`team_id`/`duration` as an explicit `null`
 * (a key column, which "an explicit null clears"), a dropped list as `[]`, dropped metadata as `{}`.
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
    if (field === 'metadata') body.metadata = { ...props.metadata };
    if (field === 'duration') body.duration = props.duration ?? null;
  }
  return body;
};

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

const stringOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * One row of `/key/list?return_full_object=true`. The row's `token` (LiteLLM's hash of the key), and
 * every other column not named in `KeyAttributes`, is dropped here on purpose.
 */
export const toAttributes = (row: Record<string, unknown>): KeyAttributes => {
  const metadata = row['metadata'];
  return {
    allowedRoutes: strings(row['allowed_routes']),
    budgetId: stringOrNull(row['budget_id']),
    duration: null,
    expires: stringOrNull(row['expires']),
    keyAlias: String(row['key_alias']),
    metadata:
      typeof metadata === 'object' && metadata !== null && !Array.isArray(metadata)
        ? (metadata as Record<string, unknown>)
        : {},
    models: strings(row['models']),
    teamId: stringOrNull(row['team_id']),
  };
};

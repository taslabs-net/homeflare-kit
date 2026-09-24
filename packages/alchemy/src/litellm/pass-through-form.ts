/**
 * The wire body for a `LiteLLM.PassThroughEndpoint`, the comparison that decides whether it needs
 * writing, and the refusals that stop a plan before it writes anything unsafe.
 *
 * ★ EXTRACTED SO IT CAN BE TESTED WITHOUT A SERVER — the same reason netbox keeps `prefix-form.ts`
 *   beside `prefix.ts` (S32/testing-and-docs.md).
 *
 * ⛔ PROPS ARE `@distilled.cloud/litellm`'s OWN GENERATED TYPE, MINUS THE TWO FIELDS THIS RESOURCE
 *   OWNS ITSELF: `id` (a deterministic physical name — pass-through-endpoint.ts) and
 *   `is_from_config` (response-only; the vendor sets it, a declaration never does). Deriving
 *   `Props` with `Omit<>` rather than hand-typing it means a vendor schema change the SDK's own
 *   next regeneration picks up is felt here as a compiler error, not silently ignored — the same
 *   reason this used to derive from the kit's own hand-generated `./generated/pass-through.ts`
 *   (retired by this migration: the SDK's type is the same shape, generated from the same LiteLLM
 *   1.100.0 OpenAPI document, and keeping a second copy would only drift).
 */
import { deepEqual } from 'alchemy/Diff';
import type * as Generated from '@distilled.cloud/litellm/misc';

export type PassThroughEndpointProps = Omit<
  Generated.PassThroughGenericEndpoint,
  'id' | 'is_from_config'
>;

/** What `read` returns: the props plus the two vendor-owned fields, `id` now guaranteed present. */
export type PassThroughEndpointAttributes = Omit<Generated.PassThroughGenericEndpoint, 'id'> & {
  readonly id: string;
};

/** ⚠️ NetBox `settled()`'s pattern: only fields the SCHEMA gives a vendor default for, copied from it (not assumed). */
export const settled = (props: PassThroughEndpointProps) => ({
  auth: props.auth ?? true,
  cost_per_request: props.cost_per_request ?? 0,
  default_query_params: props.default_query_params ?? {},
  headers: props.headers ?? {},
  include_subpath: props.include_subpath ?? false,
});

/** The three fields whose absence the vendor's `exclude_none` update can never write (see client.ts). */
export const NULLABLE_FIELDS = ['timeout', 'methods', 'guardrails'] as const;

const isUnset = (value: unknown): boolean => value === undefined || value === null;

/**
 * ⚠️ BUILT AS A WIDER RECORD AND PRUNED, NOT AS THE GENERATED TYPE DIRECTLY.
 *   `exactOptionalPropertyTypes` is on (packages/config/tsconfig.base.json), so writing
 *   `timeout: undefined` into a `{ timeout?: number | null }` is a type error rather than an
 *   absent key — the same reason `codegen/openapi.ts`'s `prune` exists, and the same fix.
 */
const prune = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined));

/**
 * Full body for CREATE. `id` is the deterministic physical name (pass-through-endpoint.ts), sent
 * so a failed create is recoverable by `read` rather than orphaning a second row on retry.
 */
export const createBody = (
  props: PassThroughEndpointProps,
  id: string,
): Generated.PassThroughGenericEndpoint =>
  prune({
    ...settled(props),
    guardrails: isUnset(props.guardrails) ? undefined : props.guardrails,
    id,
    methods: isUnset(props.methods) ? undefined : props.methods,
    path: props.path,
    target: props.target,
    timeout: isUnset(props.timeout) ? undefined : props.timeout,
  }) as unknown as Generated.PassThroughGenericEndpoint;

/**
 * Partial body for UPDATE (`POST /{id}`). ⛔ ONLY FIELDS THIS DECLARATION ACTUALLY SETS — the
 * vendor merges the parsed body with `model_dump(exclude_none=True)` (measured at v1.100.0), so an
 * `undefined` OR an explicit `null` here would be dropped by the server anyway; sending neither is
 * the same outcome with no request made when nothing changed (`Object.keys(body).length === 0`
 * checked by the caller in pass-through-endpoint.ts).
 *
 * ⛔ `path`/`target` ARE NOT `Partial` HERE, UNLIKE EVERY OTHER FIELD. The SDK's own update
 *   request type requires both non-optionally (the vendor's PATCH route still wants the full
 *   route/target pair on every call, unlike the other fields' `exclude_none` merge) — typing them
 *   as always-present here is what lets `operations.ts`'s `updatePassThroughEndpoint` pass this
 *   straight to the SDK without an unsafe cast.
 */
export type UpdateBody = Partial<Omit<Generated.PassThroughGenericEndpoint, 'path' | 'target'>> &
  Pick<Generated.PassThroughGenericEndpoint, 'path' | 'target'>;

export const updateBody = (props: PassThroughEndpointProps): UpdateBody =>
  prune({
    ...settled(props),
    guardrails: isUnset(props.guardrails) ? undefined : props.guardrails,
    methods: isUnset(props.methods) ? undefined : props.methods,
    path: props.path,
    target: props.target,
    timeout: isUnset(props.timeout) ? undefined : props.timeout,
  }) as UpdateBody;

/**
 * Whether ANY of the three nullable fields went from set (in `live`) to unset (in `props`) — the
 * one case `updateBody` cannot express, because the vendor's `exclude_none` merge silently keeps
 * the old value instead of clearing it. Detected here so `pass-through-endpoint.ts` can plan a
 * `replace` (delete-then-create) instead of an update that would look like it worked.
 */
export const needsReplace = (
  live: PassThroughEndpointAttributes,
  props: PassThroughEndpointProps,
): boolean => NULLABLE_FIELDS.some((field) => !isUnset(live[field]) && isUnset(props[field]));

/** Whether the live object already says what the declaration says — the `diff` "noop" test. */
export const matches = (
  live: PassThroughEndpointAttributes,
  props: PassThroughEndpointProps,
): boolean => {
  const fixed = settled(props);
  return (
    live.target === props.target &&
    live.auth === fixed.auth &&
    live.cost_per_request === fixed.cost_per_request &&
    live.include_subpath === fixed.include_subpath &&
    deepEqual(live.headers, fixed.headers) &&
    deepEqual(live.default_query_params, fixed.default_query_params) &&
    (isUnset(props.timeout) ? isUnset(live.timeout) : live.timeout === props.timeout) &&
    (isUnset(props.methods) ? isUnset(live.methods) : deepEqual(live.methods, props.methods)) &&
    (isUnset(props.guardrails)
      ? isUnset(live.guardrails)
      : deepEqual(live.guardrails, props.guardrails))
  );
};

/**
 * A literal secret in a forwarded header (S25, house rule — not a vendor one; see
 * pass-through-endpoint.ts). Case-insensitive on the header name; the reference form is LiteLLM's
 * own, `os.environ/NAME` (`set_env_variables_in_header`, pass_through_endpoints.py:117-160 at the
 * tag) — a missing variable on the proxy host leaves that literal string in the header, which
 * nothing in the API can detect, so this is enforced here rather than trusted to the vendor.
 */
const SECRET_HEADER_NAMES = new Set(['authorization', 'x-api-key', 'cf-aig-authorization']);

export const literalSecretHeaders = (
  headers: Readonly<Record<string, unknown>> | undefined,
): readonly string[] =>
  Object.entries(headers ?? {})
    .filter(
      ([name, value]) =>
        SECRET_HEADER_NAMES.has(name.toLowerCase()) && !String(value).includes('os.environ/'),
    )
    .map(([name]) => name);

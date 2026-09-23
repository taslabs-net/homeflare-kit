/**
 * Wire coercions shared across Forgejo resources.
 *
 * ★ GITEA/FORGEJO JSON USES snake_case ON THE WIRE and camelCase in props — each resource
 *   translates at the form boundary; these helpers only normalise values for comparison.
 *
 * ⛔ `text`/`bool`/`int` FROM THE HAND-ROLLED CLIENT ERA ARE GONE. They coerced values out of an
 *   untyped `Record<string, unknown>` response. `@distilled.cloud/forgejo`'s operations decode
 *   into typed structs (`Repository`, `Label`, `BranchProtection`, …), so an optional field is
 *   already `string | undefined` / `boolean | undefined` — a plain `live.field ?? fallback` at
 *   the call site replaces every one of their call sites, and a malformed response now fails the
 *   operation's decode instead of silently coercing to a fallback.
 */

/** Forgejo returns label colours without `#`; declarations may include it. */
export const color = (value: string) => value.replace(/^#/, '').toLowerCase();

/** Wire arrays compared in sorted order — Gitea reshuffles nothing but callers should not depend on order. */
export const stringArray = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').toSorted()
    : [];

export const stringRecord = (value: unknown): Record<string, string> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
};

export const recordEqual = (left: Record<string, string>, right: Record<string, string>) => {
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => rightKeys[index] === key && left[key] === right[key]);
};

/** Hook `config` without `secret` — the value must never land in Alchemy attributes. */
export const hookConfigPublic = (value: unknown) => {
  const config = stringRecord(value);
  const { secret: _secret, ...rest } = config;
  return rest;
};

/** Env key for a write-only org actions secret — value read at PUT time only, never stored. */
export const orgSecretEnvKey = (org: string, name: string) =>
  `FORGEJO_ORG_SECRET_${org}_${name}`.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();

/** Env key for a write-only repo webhook HMAC secret — omitted from attributes and props. */
export const hookSecretEnvKey = (owner: string, repo: string, name: string) =>
  `FORGEJO_HOOK_SECRET_${owner}_${repo}_${name}`.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();

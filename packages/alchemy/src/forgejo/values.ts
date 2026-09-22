/**
 * Wire coercions shared across Forgejo resources.
 *
 * ★ GITEA/ FORGEJO JSON USES snake_case ON THE WIRE and camelCase in props — each resource
 *   translates at the form boundary; these helpers only normalise values for comparison.
 */

export const text = (value: unknown, fallback = '') =>
  typeof value === 'string' ? value : fallback;

/** Forgejo returns label colours without `#`; declarations may include it. */
export const color = (value: unknown) => text(value).replace(/^#/, '').toLowerCase();

export const bool = (value: unknown, fallback = false) =>
  value === undefined || value === null ? fallback : value === true || value === 1 || value === '1';

export const int = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

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

/**
 * Wire coercions shared across Argo CD resources.
 *
 * ⚠️ EVERY FIELD ON A GENERATED ARGO TYPE IS `S.optional(...)`. A live read is
 *   `string | undefined` even for a field the API always sends. These helpers turn that into the
 *   settled value `matches()` compares against, mirroring `../forgejo/values.ts`.
 */

export const text = (value: string | undefined): string => value ?? '';

export const bool = (value: boolean | undefined): boolean => value === true;

export const stringArray = (value: readonly string[] | undefined): string[] =>
  value === undefined ? [] : [...value].toSorted();

export const recordEqual = (
  left: Record<string, string>,
  right: Record<string, string>,
): boolean => {
  const leftKeys = Object.keys(left).toSorted();
  const rightKeys = Object.keys(right).toSorted();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key, index) => rightKeys[index] === key && left[key] === right[key]);
};

export const arraysEqual = (left: readonly string[], right: readonly string[]): boolean => {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
};

/** Env key suggestion for a write-only repo password — the value is never a prop. */
export const repoPasswordEnvKey = (repo: string): string =>
  `ARGOCD_REPO_PASSWORD_${repo}`.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase();

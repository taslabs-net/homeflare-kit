/**
 * A Cloudflare policy document as the engine stores it — resolution from names, parsing from a
 * read, and the one comparison every Bao.CloudflareRole plan rests on.
 *
 * MEASURED from the engine source (house/platform/secrets/vault/plugin/cloudflare/path_roles.go)
 * and the 2026-09-14 snapshot of all 586 live roles:
 *   • `policies` is a STRING field holding a JSON array (path_roles.go:67-72). Each entry is
 *     `{effect, resources: map[string]string, permission_groups: [{id}]}` (:25-33).
 *   • A read hands back `json.Marshal` of the stored slice (:199-207): no whitespace, entry and
 *     group order preserved (Go slices), resource keys sorted (Go maps). Every snapshot role has
 *     exactly that shape.
 */
import { GROUP_SCOPES, groupKey, scopeOfResource } from './cloudflare-group-scope.ts';
import type { DeclaredPolicy } from './cloudflare-roles-expand.ts';

export interface WirePolicy {
  readonly effect: string;
  readonly resources: Readonly<Record<string, string>>;
  readonly groupIds: readonly string[];
}

/** A declared entry with its IDs, still carrying how its group order is to be compared. */
export interface ResolvedPolicy extends WirePolicy {
  readonly groupOrder: DeclaredPolicy['groupOrder'];
}

/**
 * One name at every scope — what a source that cannot see scopes can honestly offer.
 *
 * ⚠️ IT IS A WIDENING, AND IT IS THE ASYMMETRY BETWEEN THE TWO SOURCES. The live-roles bootstrap
 *   and cloudflare-permission-groups-solve.ts recover `name → id` from roles that carry ids and no
 *   scopes, so they cannot tell the seven two-id names apart; the id they learned is offered for
 *   whatever scope an entry asks. The engine source keys by (name, scope) and never does this.
 */
export const atEveryScope = (byName: ReadonlyMap<string, string>): ReadonlyMap<string, string> =>
  new Map(
    [...byName].flatMap(([name, id]) =>
      Object.values(GROUP_SCOPES).map((scope) => [groupKey(name, scope), id] as const),
    ),
  );

/**
 * Declared names to IDs, or the names `ids` lacks.
 *
 * ⛔ AN ENTRY LOOKS ITS GROUPS UP AT ITS OWN SCOPE (`groupKey`), not by name: a zone entry and an
 *   account entry of the same role can name one group and mean two different ids.
 * ★ THE ACCOUNT ENTRY IS SORTED BY ID, EXACTLY AS cfhf.py:180 DID. ⚠️ Plain `sort()`, never
 *   `localeCompare`: Python's `sorted()` on str is codepoint order, and JavaScript's default sort
 *   is UTF-16 code-unit order, which agree on the lowercase hex these IDs are made of.
 */
export const resolvePolicies = (
  declared: readonly DeclaredPolicy[],
  ids: ReadonlyMap<string, string>,
): { readonly policies: ResolvedPolicy[]; readonly missing: string[] } => {
  const missing = new Set<string>();
  const policies = declared.map((policy) => {
    /**
     * ⛔ THE ENTRY'S OWN WORD BEATS ITS RESOURCE. `scope` is roles.yaml `groups_scope:` reaching
     *   here unchanged; `scopeOfResource` is the default for the 639 of 643 references that say
     *   nothing. The four that do are `logs`/`logs-read` on both security mounts — ACCOUNT roles
     *   whose live entry carries the ZONE-scoped `Logs` ids, which is how Cloudflare writes "all
     *   zones from an account" (cf-mint-analytics-tokens.py:155-158).
     */
    const scope = policy.scope ?? scopeOfResource(policy.resource);
    const groupIds = policy.groups.flatMap((name) => {
      const id = ids.get(groupKey(name, scope));
      if (id === undefined) missing.add(name);
      return id === undefined ? [] : [id];
    });
    return {
      effect: policy.effect,
      groupIds: policy.groupOrder === 'by-id' ? [...groupIds].sort() : groupIds,
      groupOrder: policy.groupOrder,
      resources: { [policy.resource]: '*' },
    };
  });
  return { missing: [...missing].sort(), policies };
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringMap = (value: unknown): Readonly<Record<string, string>> | undefined => {
  if (!isRecord(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') return undefined;
    out[key] = item;
  }
  return out;
};

const entryOf = (entry: unknown): WirePolicy | undefined => {
  if (!isRecord(entry) || typeof entry['effect'] !== 'string') return undefined;
  const resources = stringMap(entry['resources']);
  const groups = entry['permission_groups'];
  if (resources === undefined || !Array.isArray(groups)) return undefined;
  const groupIds = groups.flatMap((group) =>
    isRecord(group) && typeof group['id'] === 'string' ? [group['id']] : [],
  );
  return groupIds.length === groups.length
    ? { effect: entry['effect'], groupIds, resources }
    : undefined;
};

/**
 * The live `policies` string parsed, or undefined when it is not a policy document.
 *
 * ⚠️ UNDEFINED IS NOT ABSENCE. It means the role exists and its policies could not be read, which
 *   compares unequal to every declaration — so it plans `update`, and reconcile's re-read refuses
 *   to call a write that still reads back like that a success.
 */
export const parseLivePolicies = (raw: unknown): WirePolicy[] | undefined => {
  if (typeof raw !== 'string') return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const policies = parsed.map(entryOf);
  return policies.every((policy): policy is WirePolicy => policy !== undefined)
    ? policies
    : undefined;
};

/**
 * The `policies` field for a write — the array cfhf.py:174-180 built, serialized.
 *
 * ⚠️ NOT BYTE-IDENTICAL TO WHAT PYTHON SENT, AND IT NEED NOT BE. `json.dumps` put a space after
 *   every `:` and `,`; this emits none. The engine unmarshals the string into structs
 *   (path_roles.go:161-166) and stores those, never the text, so the stored role and the read
 *   that diff compares are the same either way.
 */
export const policiesJson = (policies: readonly WirePolicy[]) =>
  JSON.stringify(
    policies.map((policy) => ({
      effect: policy.effect,
      resources: policy.resources,
      permission_groups: policy.groupIds.map((id) => ({ id })),
    })),
  );

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, i) => item === b[i]);

const sameResources = (
  a: Readonly<Record<string, string>>,
  b: Readonly<Record<string, string>>,
) => {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
};

/**
 * ⛔ THE POLICY EQUALITY.
 *
 *   • Entry count and entry ORDER must match: cfhf.py always wrote the scope entry first and the
 *     account entry second (cfhf.py:174-180).
 *   • Within an entry: effect, the resource map, and the group IDs — IN ORDER for a `declared`
 *     entry, because cfhf.py:175 kept yaml order; AS A SORTED LIST for a `by-id` entry, because
 *     cfhf.py:180 sorted it, so its order never carried meaning.
 *
 * ⚠️ NOT ORDER-INSENSITIVE EVERYWHERE, ON PURPOSE. Cloudflare treats a group list as a set, so a
 *   reordered `declared` entry mints an identical token — and still plans `update` here. The
 *   Python would have rewritten it as well, and an adoption that is noop only up to reordering
 *   would not prove the port exact.
 */
export const samePolicies = (want: readonly ResolvedPolicy[], have: readonly WirePolicy[]) =>
  want.length === have.length &&
  want.every((w, i) => {
    const h = have[i];
    if (h === undefined || w.effect !== h.effect || !sameResources(w.resources, h.resources)) {
      return false;
    }
    return w.groupOrder === 'by-id'
      ? sameList([...w.groupIds].sort(), [...h.groupIds].sort())
      : sameList(w.groupIds, h.groupIds);
  });

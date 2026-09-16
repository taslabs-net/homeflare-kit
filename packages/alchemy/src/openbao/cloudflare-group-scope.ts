/**
 * The three resources a Cloudflare policy entry can name, and the SCOPE its permission groups are
 * looked up at — one vocabulary, both directions.
 *
 * ★ EXTRACTED FROM cloudflare-roles-expand.ts 2026-09-15, which had reached 270 lines (AGENTS.md
 *   rule 5, code ≤250). The split is by CONCERN, not by size: expand.ts turns roles.yaml into
 *   roles, this answers "which of the two ids named `Logs Read` does this entry mean".
 */

/** cfhf.py:172-173. */
export const zoneResource = (zoneId: string) => `com.cloudflare.api.account.zone.${zoneId}`;
export const accountResource = (accountId: string) => `com.cloudflare.api.account.${accountId}`;

/**
 * One R2 bucket, which is a DIFFERENT RESOURCE NAMESPACE from the two above.
 *
 * ⛔ `com.cloudflare.edge.r2.bucket.…`, NOT `com.cloudflare.api.account.…`, and the three parts are
 *   joined by UNDERSCORES inside the last segment — `<accountId>_<jurisdiction>_<bucket>`. Getting
 *   the separator wrong produces a syntactically fine resource that matches no bucket, and the
 *   token mints successfully and is refused on first use, which reads exactly like a missing
 *   permission group. Per Cloudflare's R2 API-token documentation, read 2026-09-15.
 * ⚠️ AND IT ONLY BINDS THE `Bucket Item` GROUPS. `Workers R2 Storage Write` / `… Read` are gated at
 *   the ACCOUNT scope; the bucket-scoped pair is `Workers R2 Storage Bucket Item Write` / `… Read`.
 *   Pairing an account group with this resource is the same silent 403.
 */
export const bucketResource = (accountId: string, jurisdiction: string, bucket: string) =>
  `com.cloudflare.edge.r2.bucket.${accountId}_${jurisdiction}_${bucket}`;

/**
 * The three scopes this expansion can ask for — the namespaces of the three resources above, which
 * is exactly what the engine reports as a group's `scopes`.
 *
 * ★ MEASURED on `cloudflare-<account>-platform/permission-groups`, 2026-09-15 12:10: 401 groups,
 *   every one with exactly ONE scope, over five values — 297 `com.cloudflare.api.account`, 94
 *   `com.cloudflare.api.account.zone`, 2 `com.cloudflare.edge.r2.bucket` and four each of
 *   `…account.flagship.app` and `com.cloudflare.edge.worker.script`, which no resource here builds.
 *   The testing account's list is byte-identical, so the ids are Cloudflare's, not an account's.
 */
export const GROUP_SCOPES = {
  account: 'com.cloudflare.api.account',
  bucket: 'com.cloudflare.edge.r2.bucket',
  zone: 'com.cloudflare.api.account.zone',
} as const;

/**
 * The short word roles.yaml writes in `groups_scope:` → the namespace: `zone` becomes
 * `com.cloudflare.api.account.zone`. Undefined for a word that is not one of the three KEYS above.
 *
 * ⛔ THE yaml SAYS THE SHORT WORD AND NEVER THE NAMESPACE. A namespace typed into roles.yaml would
 *   be accepted by any check that only asked for a string, and a misspelt one resolves no group at
 *   all — an unknown-group failure naming a scope nobody wrote on purpose, instead of the line.
 * ⚠️ `Object.entries(…).find`, NOT an index with a narrowing `as`: codex standard 2 bans the cast,
 *   and the lookup has three entries.
 */
export const groupScopeNamed = (word: string): string | undefined =>
  Object.entries(GROUP_SCOPES).find(([name]) => name === word)?.[1];

/**
 * The scope the groups of one policy entry are gated at: its resource namespace, the instance id
 * dropped. A zone entry asks for zone groups, an account entry for account groups, a bucket entry
 * for the two `com.cloudflare.edge.r2.bucket` ones.
 *
 * ⛔ ZONE IS TESTED BEFORE ACCOUNT, because `com.cloudflare.api.account.zone.<id>` also starts with
 *   the account namespace, and the wrong order would call every zone entry an account one.
 * ⚠️ A RESOURCE IN NO KNOWN NAMESPACE BECOMES ITS OWN SCOPE, which matches no group, so it fails as
 *   an unresolvable name naming the scope it asked for — never by borrowing another scope's id.
 * ⚠️ IT IS THE DEFAULT, NOT THE LAST WORD. An entry carrying an explicit `scope` overrides it —
 *   see DeclaredPolicy.scope (cloudflare-roles-expand.ts) and resolvePolicies.
 */
export const scopeOfResource = (resource: string) => {
  const scopes = [GROUP_SCOPES.zone, GROUP_SCOPES.bucket, GROUP_SCOPES.account];
  return scopes.find((scope) => resource.startsWith(`${scope}.`)) ?? resource;
};

/**
 * What a resolved group is filed under.
 *
 * ⛔ A NAME ALONE IS NOT A KEY. MEASURED 2026-09-15 on the live list: SEVEN names are listed twice,
 *   once at `com.cloudflare.api.account` and once at `com.cloudflare.api.account.zone` — `Access:
 *   Apps and Policies Read` / `… Revoke` / `… Write`, `Disable ESC Read` / `… Write`, `Logs Read`
 *   and `Logs Write`. cfhf.py:148 keyed by name and the last one read won in silence.
 */
export const groupKey = (name: string, scope: string) => `${scope} ${name}`;

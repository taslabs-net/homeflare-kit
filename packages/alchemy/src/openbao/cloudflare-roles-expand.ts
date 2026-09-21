/**
 * The roles.yaml expansion — surfaces × accounts × zones into concrete roles — ported from
 * cfroles.py `expand` and cfhf.py `policy_for`, with permission groups still by NAME.
 *
 * ★ PURE, AND NAMES STAY NAMES. The Python resolved names to IDs in the same pass
 *   (apply-roles.py:144-150), with a Cloudflare credential in hand. Agents may not hold that
 *   credential, so resolution is a separate step behind one interface
 *   (cloudflare-permission-groups.ts) and nothing here knows where IDs come from.
 *
 * ⛔ THE NAMING AND THE ZONE RULES ARE CONTRACTS WITH EVERY CONSUMER. apply-consumers.py grants
 *   `creds/<slug(zone)>-*` by zone (apply-consumers.py:117-120) and agents mint by role name, so a
 *   role a port renames is a role nothing can mint. Each rule cites the line it came from, and
 *   cloudflare/parity.ts proves the whole expansion against production.
 */
import { accountResource, bucketResource, zoneResource } from './cloudflare-group-scope.ts';
import type { AccountSpec, RoleTemplate, RolesConfig } from './cloudflare-roles-config.ts';
import { trimRuns } from './mount-path.ts';

/** A zone as the expansion needs it — what cfhf.py load_account listed (cfhf.py:134-146). */
export interface CloudflareZone {
  readonly name: string;
  readonly id: string;
  /** From the `type=internal` listing. ⚠️ Shares its NAME with the public zone, never its id. */
  readonly internal: boolean;
}

/**
 * One policy entry, groups by name.
 *
 * ★ `groupOrder` CARRIES A PYTHON RULE THAT ONLY EXISTS AFTER RESOLUTION. cfhf.py:180 sorts the
 *   account entry's group IDS — not its names — so that order cannot be computed here, only
 *   promised. A `declared` entry keeps roles.yaml order, exactly as cfhf.py:175 emitted it.
 */
export interface DeclaredPolicy {
  readonly effect: 'allow';
  readonly resource: string;
  readonly groups: readonly string[];
  readonly groupOrder: 'declared' | 'by-id';
  /**
   * The scope these NAMES resolve at, when it is not this entry's own resource namespace —
   * roles.yaml `groups_scope:`, already a GROUP_SCOPES value. Undefined on every entry that does
   * not say otherwise, which is 639 of the estate's 643 group references.
   *
   * ⛔ IT MOVES THE LOOKUP, NEVER THE RESOURCE. The entry still binds the groups to the resource
   *   above; only the id chosen for each name changes. That is the shape Cloudflare calls "all
   *   zones from an account" — the ACCOUNT resource carrying ZONE-scoped groups
   *   (house/nix/homeflare-config/scripts/cf-mint-analytics-tokens.py:155-158, beside a working
   *   token). Without this field the resource is the only witness, and it says `account`.
   */
  readonly scope?: string;
}

/** What apply-roles.py wrote to the KV catalog for one role (apply-roles.py:58-62). */
export interface CatalogView {
  readonly description: string;
  readonly zone: string | null;
  readonly ttl: string;
  readonly maxTtl: string;
  readonly permissions: readonly string[];
}

export interface ExpandedRole {
  readonly account: string;
  readonly accountId: string;
  readonly mount: string;
  readonly surface: string;
  readonly name: string;
  /** Exactly what apply-roles.py:160-161 wrote — the zone suffix included. */
  readonly description: string;
  readonly ttl: string;
  readonly maxTtl: string;
  readonly policies: readonly DeclaredPolicy[];
  readonly catalog: CatalogView;
}

/** cfroles.py:18-20 — `example.com` → `homeflare-dev`. */
export const slug = (name: string) => trimRuns(name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), '-');

/**
 * cfroles.py:23-38. ⛔ THE `-internal` SUFFIX IS WHAT KEEPS TWO ZONES OF ONE NAME APART. Slugging
 *   both example.com zones alike would leave two roles fighting for one name, and whichever
 *   wrote last would silently own it.
 */
export const zoneSlug = (zone: CloudflareZone) =>
  `${slug(zone.name)}${zone.internal ? '-internal' : ''}`;

/** cfroles.py:46-47 — one mount, and so one parent token, per (account, surface). */
export const mountName = (account: string, surface: string) => `cloudflare-${account}-${surface}`;

/**
 * cfhf.py:151-181. ⛔ ONE ENTRY PER SCOPE, NEVER MERGED: Cloudflare gates a permission at one
 *   scope only, so a zone role that also needs account groups gets a SECOND entry on the account
 *   resource. ⚠️ `if account_group_ids:` — an empty list emits no second entry (cfhf.py:176).
 */
const policiesFor = (
  tpl: RoleTemplate,
  accountId: string,
  zone: CloudflareZone | null,
  accountGroups: readonly string[],
): DeclaredPolicy[] => {
  /**
   * ⛔ A BUCKET NARROWS THE ACCOUNT RESOURCE; IT NEVER NARROWS A ZONE. A zone role scoped to an R2
   *   bucket is not a narrower grant, it is an incoherent one — the groups a zone role carries are
   *   gated at the zone and would be refused against a bucket resource. Refusing here is the only
   *   place that can tell the difference; roles.yaml cannot express the contradiction as a type.
   */
  if (tpl.bucket !== undefined && zone !== null) {
    throw new Error(`${tpl.name}: a zone role cannot be scoped to R2 bucket ${tpl.bucket}`);
  }
  const accountScoped =
    tpl.bucket === undefined
      ? accountResource(accountId)
      : bucketResource(accountId, tpl.bucketJurisdiction, tpl.bucket);
  const resource = zone === null ? accountScoped : zoneResource(zone.id);
  const first: DeclaredPolicy = {
    effect: 'allow',
    groupOrder: 'declared',
    groups: tpl.groups,
    resource,
    /**
     * ⚠️ `groups_scope:` GOVERNS `groups:` AND NOTHING ELSE. The second entry below exists because
     *   `account_groups` are account-scoped BY CONSTRUCTION (cfhf.py:176-180) — overriding its
     *   scope from the same key would make one word mean two things in one template.
     * ★ OMITTED, NOT SET TO THE DEFAULT, WHEN THE yaml IS SILENT: an always-present field would
     *   rewrite the stored props of all 594 declared roles to say what the resource already said.
     */
    ...(tpl.groupsScope === undefined ? {} : { scope: tpl.groupsScope }),
  };
  if (accountGroups.length === 0) return [first];
  const second: DeclaredPolicy = {
    effect: 'allow',
    groupOrder: 'by-id',
    groups: accountGroups,
    resource: accountResource(accountId),
  };
  return [first, second];
};

const build = (
  account: AccountSpec,
  surface: string,
  tpl: RoleTemplate,
  zone: CloudflareZone | null,
  accountGroups: readonly string[],
): ExpandedRole => ({
  account: account.key,
  accountId: account.id,
  catalog: {
    description: tpl.desc,
    maxTtl: tpl.maxTtl,
    // apply-roles.py:61 — groups then account_groups, names, in file order.
    permissions: [...tpl.groups, ...accountGroups],
    ttl: tpl.ttl,
    zone: zone === null ? null : zone.name,
  },
  /**
   * apply-roles.py:160-161. ⚠️ THE ZONE NAME, NOT ITS SLUG, so a public zone and its internal
   *   twin describe alike, and an empty `desc` still gains the suffix after a leading space.
   */
  description: zone === null ? tpl.desc : `${tpl.desc} (zone: ${zone.name})`,
  maxTtl: tpl.maxTtl,
  mount: mountName(account.key, surface),
  // cfroles.py:84 for zone roles, :98 for account roles.
  name: zone === null ? tpl.name : `${zoneSlug(zone)}-${tpl.name}`,
  policies: policiesFor(tpl, account.id, zone, accountGroups),
  surface,
  ttl: tpl.ttl,
});

/** cfroles.py:50-104 for one account, in the Python's order: per surface, zone roles first. */
export const expandAccount = (
  config: RolesConfig,
  account: AccountSpec,
  zones: readonly CloudflareZone[],
): ExpandedRole[] => {
  const roles: ExpandedRole[] = [];
  for (const surface of account.surfaces) {
    const spec = config.surfaces[surface];
    if (spec === undefined) throw new Error(`surface ${surface} is not defined`);
    for (const tpl of spec.zoneRoles) {
      const only = tpl.zones;
      /**
       * ⛔ INTERNAL ZONES ARE OPT-IN PER TEMPLATE AND THE DEFAULT IS NO (cfroles.py:68-74). Only the
       *   word `internal` in zone_types matters; `full` and `secondary` are never checked, so a
       *   public zone of any type expands.
       */
      const internalOk = tpl.zoneTypes.includes('internal');
      for (const zone of zones) {
        if (account.zones !== 'all' && !account.zones.includes(zone.name)) continue; // :76
        if (only !== undefined && only.length > 0 && !only.includes(zone.name)) continue; // :78
        if (zone.internal && !internalOk) continue; // :80
        roles.push(build(account, surface, tpl, zone, tpl.accountGroups));
      }
    }
    // cfroles.py:96-103 — `account_groups` is [] on an account role, whatever the yaml says.
    for (const tpl of spec.accountRoles) roles.push(build(account, surface, tpl, null, []));
  }
  return roles;
};

/**
 * Every account's roles, grouped by mount.
 *
 * ⛔ A DUPLICATE ROLE ON ONE MOUNT IS AN ERROR HERE. apply-roles.py wrote both and the last write
 *   won in silence (apply-roles.py:157-162); declared, they are two resources fighting over one
 *   object. ⚠️ A MISSING ZONE INVENTORY IS AN ERROR TOO — an empty one is not, because an account
 *   with no zones is real, and the Python expanded it to account roles only.
 */
export const expandAll = (
  config: RolesConfig,
  zonesByAccount: Readonly<Record<string, readonly CloudflareZone[]>>,
): ReadonlyMap<string, readonly ExpandedRole[]> => {
  const byMount = new Map<string, ExpandedRole[]>();
  const seen = new Set<string>();
  for (const account of config.accounts) {
    const zones = zonesByAccount[account.key];
    if (zones === undefined) throw new Error(`no zone inventory for account ${account.key}`);
    for (const role of expandAccount(config, account, zones)) {
      const key = `${role.mount}/roles/${role.name}`;
      if (seen.has(key)) throw new Error(`roles.yaml expands ${key} twice`);
      seen.add(key);
      const mount = byMount.get(role.mount) ?? [];
      mount.push(role);
      byMount.set(role.mount, mount);
    }
  }
  return byMount;
};

/**
 * roles.yaml, parsed and checked — the input half of the Cloudflare role expansion. The expansion
 * itself is cloudflare-roles-expand.ts.
 *
 * ★ BUN's OWN PARSER, NO DEPENDENCY. `Bun.YAML.parse` ships in Bun 1.4 — MEASURED on 1.4.0:
 *   `typeof Bun.YAML` is `object` with `parse` and `stringify`, typed in bun-types 1.4.2
 *   (bun.d.ts:1479). The Python read the same file with PyYAML's `safe_load` (cfroles.py:41-43).
 * ⚠️ THEY ARE DIFFERENT PARSERS, SO THE SHAPE IS CHECKED, NOT TRUSTED. The file leans on flow
 *   mappings (`- { name: dns-edit, groups: [DNS Write] }`), and a bare `5m` must stay a string.
 *   MEASURED against roles.yaml: both parsers give `ttl` as the string `5m`, and both keep
 *   `'Access: Apps and Policies Write'` as one name. parity.ts against the live snapshot is the
 *   end-to-end proof; a field of the wrong type fails loudly here instead of expanding to nonsense.
 *
 * ⛔ A MISSING FIELD IS AN ERROR, NEVER A DEFAULT — except exactly where the Python defaulted:
 *   `desc` to '' (cfroles.py:86, :100), an account's `zones` to "all" (:57), `surfaces`,
 *   `zone_roles` and `account_roles` to empty (:59, :62, :96), `zone_types` to empty (:74) and
 *   `account_groups` to empty (:90). Everywhere else the Python raised KeyError, and so does this.
 *
 * ⚠️ `consumers:` IS NOT READ HERE. It belongs to apply-consumers.py, and declaring it is the next
 *   phase — see the report that came with this file.
 */
import { GROUP_SCOPES, groupScopeNamed } from './cloudflare-group-scope.ts';

/** One `zone_roles` or `account_roles` entry. */
export interface RoleTemplate {
  readonly name: string;
  readonly groups: readonly string[];
  /** Duration text exactly as written (`5m`), which is what apply-roles.py sent. */
  readonly ttl: string;
  readonly maxTtl: string;
  readonly desc: string;
  /** `zones:` narrowing. Undefined or empty narrows nothing — `if only and …` (cfroles.py:78). */
  readonly zones: readonly string[] | undefined;
  readonly zoneTypes: readonly string[];
  /** Account-scoped groups on a ZONE role. Ignored on account roles, as cfroles.py:101 ignores it. */
  readonly accountGroups: readonly string[];
  /**
   * One R2 bucket NAME, narrowing an account role's resource to that bucket alone.
   *
   * ⛔ BUCKET IS THE FINEST GRAIN R2 HAS — A PREFIX CANNOT BE SCOPED. So one repository per
   *   instance in its own bucket is the only least-privilege shape for a backup credential, and
   *   this field is what expresses it. Undefined leaves the role account-wide, which is what every
   *   role declared before 2026-09-15 is.
   * ⚠️ IT ONLY MEANS ANYTHING WITH THE `Bucket Item` GROUPS. `Workers R2 Storage Write` is gated at
   *   the ACCOUNT scope, so pairing it with a bucket resource is a token Cloudflare will mint and
   *   that will then be refused on every call. roles.yaml says which pair goes with which.
   */
  readonly bucket: string | undefined;
  /**
   * The bucket's jurisdiction, which is part of its resource id and not cosmetic — a bucket
   * created in `default` is a different resource from the same name under `eu`. Defaults to
   * `default`, which is what every bucket in this estate is (measured: `r2_bucket_get` reports
   * `jurisdiction default` on all 34).
   */
  readonly bucketJurisdiction: string;
  /**
   * roles.yaml `groups_scope:` — the scope this template's `groups:` NAMES resolve at, as a
   * GROUP_SCOPES value. Undefined means the entry's own resource namespace, which is every
   * template written before 2026-09-15.
   *
   * ⛔ IT SAYS WHICH ID, NOT WHICH RESOURCE. `groups_scope: zone` on an ACCOUNT role keeps the
   *   account resource and takes the zone-scoped id of each name — Cloudflare's "all zones from
   *   this account" (cf-mint-analytics-tokens.py:155-158). It is meaningful only for the seven
   *   names the engine lists at two scopes; anywhere else the name has one id and answers alike.
   */
  readonly groupsScope: string | undefined;
}

export interface SurfaceSpec {
  readonly zoneRoles: readonly RoleTemplate[];
  readonly accountRoles: readonly RoleTemplate[];
}

export interface AccountSpec {
  /** The key under `accounts:` — the `<account>` in `cloudflare-<account>-<surface>`. */
  readonly key: string;
  readonly id: string;
  readonly zones: 'all' | readonly string[];
  readonly surfaces: readonly string[];
}

export interface RolesConfig {
  readonly namespace: string;
  readonly surfaces: Readonly<Record<string, SurfaceSpec>>;
  /** In file order, which is the order apply-roles.py walked them (apply-roles.py:111). */
  readonly accounts: readonly AccountSpec[];
}

export class RolesConfigError extends Error {
  constructor(where: string, problem: string) {
    super(`roles.yaml ${where}: ${problem}`);
    this.name = 'RolesConfigError';
  }
}

type Raw = Readonly<Record<string, unknown>>;

const isRaw = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const record = (value: unknown, where: string): Raw => {
  if (!isRaw(value)) throw new RolesConfigError(where, 'expected a mapping');
  return value;
};

const text = (raw: Raw, key: string, where: string): string => {
  const value = raw[key];
  if (typeof value === 'string') return value;
  /**
   * ⚠️ STRICTER THAN THE PYTHON FOR A NUMBER. `ttl: 300` would have reached `bao write` as `300`
   *   and been read as seconds. Every duration in roles.yaml is unit-suffixed, and the comparison
   *   in cloudflare-role-form.ts only parses unit-suffixed text, so a bare number is refused here
   *   rather than planning an update that can never settle.
   */
  throw new RolesConfigError(`${where}.${key}`, `expected a string, got ${JSON.stringify(value)}`);
};

const texts = (raw: Raw, key: string, where: string): readonly string[] | undefined => {
  const value = raw[key];
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value) && value.every((item): item is string => typeof item === 'string')) {
    return value;
  }
  throw new RolesConfigError(`${where}.${key}`, 'expected a list of strings');
};

const entries = (raw: Raw, key: string, where: string): readonly unknown[] => {
  const value = raw[key];
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new RolesConfigError(`${where}.${key}`, 'expected a list');
  return value;
};

const template = (value: unknown, where: string): RoleTemplate => {
  const raw = record(value, where);
  const groups = texts(raw, 'groups', where);
  if (groups === undefined) throw new RolesConfigError(`${where}.groups`, 'is required');
  /**
   * ⚠️ `bucket` IS OPTIONAL BUT NEVER EMPTY. `bucket: ''` would expand to the resource
   *   `…r2.bucket.<acct>_default_`, which is not a bucket and not the account either — a policy
   *   that names nothing. A missing key means account-wide; a present one must name a bucket.
   */
  const bucket = raw['bucket'] === undefined ? undefined : text(raw, 'bucket', where);
  if (bucket !== undefined && bucket.length === 0) {
    throw new RolesConfigError(`${where}.bucket`, 'is empty; omit it to stay account-wide');
  }
  /**
   * ⛔ AN UNKNOWN WORD IS AN ERROR, NEVER A PASS-THROUGH. A scope roles.yaml invents matches no
   *   group at all, so accepting it would turn a typo into "unknown group X at scope zonee" at
   *   deploy time — a failure naming the group rather than the line that is wrong.
   */
  const groupsScope =
    raw['groups_scope'] === undefined
      ? undefined
      : groupScopeNamed(text(raw, 'groups_scope', where));
  if (raw['groups_scope'] !== undefined && groupsScope === undefined) {
    throw new RolesConfigError(
      `${where}.groups_scope`,
      `expected one of ${Object.keys(GROUP_SCOPES).join(', ')}`,
    );
  }
  return {
    accountGroups: texts(raw, 'account_groups', where) ?? [],
    bucket,
    bucketJurisdiction:
      raw['bucket_jurisdiction'] === undefined
        ? 'default'
        : text(raw, 'bucket_jurisdiction', where),
    desc: raw['desc'] === undefined ? '' : text(raw, 'desc', where),
    groups,
    groupsScope,
    maxTtl: text(raw, 'max_ttl', where),
    name: text(raw, 'name', where),
    ttl: text(raw, 'ttl', where),
    zoneTypes: texts(raw, 'zone_types', where) ?? [],
    zones: texts(raw, 'zones', where),
  };
};

const surface = (name: string, value: unknown): SurfaceSpec => {
  const where = `surfaces.${name}`;
  const raw = record(value, where);
  return {
    accountRoles: entries(raw, 'account_roles', where).map((item, i) =>
      template(item, `${where}.account_roles[${String(i)}]`),
    ),
    zoneRoles: entries(raw, 'zone_roles', where).map((item, i) =>
      template(item, `${where}.zone_roles[${String(i)}]`),
    ),
  };
};

const account = (
  key: string,
  value: unknown,
  surfaces: Readonly<Record<string, SurfaceSpec>>,
): AccountSpec => {
  const where = `accounts.${key}`;
  const raw = record(value, where);
  const names = texts(raw, 'surfaces', where) ?? [];
  for (const name of names) {
    /** ⚠️ cfroles.py:60 would raise KeyError at expansion; this says which account named it. */
    if (surfaces[name] === undefined) {
      throw new RolesConfigError(
        `${where}.surfaces`,
        `names ${name}, which surfaces: never defines`,
      );
    }
  }
  const zones =
    raw['zones'] === undefined || raw['zones'] === 'all' ? 'all' : texts(raw, 'zones', where);
  return { id: text(raw, 'id', where), key, surfaces: names, zones: zones ?? 'all' };
};

/** Parse and check roles.yaml. Throws RolesConfigError naming the first bad field. */
export const parseRolesConfig = (yaml: string): RolesConfig => {
  const root = record(Bun.YAML.parse(yaml), '(document)');
  const surfaces: Record<string, SurfaceSpec> = {};
  for (const [name, spec] of Object.entries(record(root['surfaces'], 'surfaces'))) {
    surfaces[name] = surface(name, spec);
  }
  const accounts = Object.entries(record(root['accounts'], 'accounts')).map(([key, value]) =>
    account(key, value, surfaces),
  );
  return {
    accounts,
    namespace: text(record(root['defaults'], 'defaults'), 'namespace', 'defaults'),
    surfaces,
  };
};

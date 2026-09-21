/**
 * One AppRole role per host, generated from a host list and a few class definitions — pure, so a
 * scaffold test can render every role from one site config and assert on it without a vault.
 *
 * ★ WHY PER HOST, NOT PER CLASS. OpenBao sets an AppRole login's entity alias to the role_id, so
 *   every host sharing a class role is ONE identity: one entity in every audit line, and one cached
 *   token when two hosts send the same login through a caching proxy (vault consolidation plan,
 *   decision 8 as amended 2026-09-21; not re-measured here). The CLASS carries the policies and
 *   TTLs; the ROLE carries the host.
 *
 * ★ THE NAMING RULE: `<class>--<host>`, e.g. `pve-node--node-a`.
 *   · Class and host names are lowercase letters, digits and SINGLE hyphens, so `--` can only ever
 *     be the separator and a name splits back into exactly one (class, host) pair.
 *   · Class first, so one class's roles share a prefix a reader (or a policy path glob,
 *     `auth/approle/role/pve-node--*`) can select — and no hand-made role (`deploy`,
 *     `approle-rotator`) can match it, because none of them contains `--`.
 *   · Lowercase because AppRole stores role names lowercased (builtin/credential/approle stores
 *     `role/<lowercased name>`); a mixed-case name would read back as a different string.
 *
 * ⛔ NO ROLE WITHOUT AN EXPIRING SECRET_ID. `secretIdTtl` must parse to MORE than zero: `0` is a
 *   secret_id that never expires, which is the `deploy` credential the plan is retiring. The plan's
 *   class default is 90 days (`2160h`, which auth-role-form.test.ts shows OpenBao accepts).
 * ⛔ `bindSecretId` IS ALWAYS TRUE. A role that logs in on role_id alone makes the role_id — which
 *   is not treated as a secret — the whole credential.
 * ⚠️ A RENAMED HOST OR CLASS IS A NEW ROLE: a new role_id, and a new secret_id to push to the host
 *   in the same change. What Alchemy calls it depends on the logical id. Keyed by the role name (as
 *   the README does), the old id VANISHES from the stack, so it is an orphan delete, not a
 *   `replace`. Keyed by something stable, Bao.AuthRole plans a `replace`. Either way the default
 *   `retain` leaves the old role LIVE, its secret_ids still logging in (alchemy Plan.ts:2040 and
 *   Apply.ts:2152-2173 honour retain on both paths) — see the ⚠️ in auth-role.ts before renaming.
 */
import type { BaoAuthRoleProps } from './auth-role-form.ts';
import { parseDuration } from './mount-form.ts';

/** What every host of one class gets. */
export interface HostRoleClass {
  /** Policy names. ⛔ Never empty, never `root`. */
  readonly policies: readonly string[];
  readonly tokenTtl: string;
  readonly tokenMaxTtl: string;
  /** ⛔ Must be more than zero — e.g. `2160h` (90 days). */
  readonly secretIdTtl: string;
  /** `0` (the default) means unlimited uses, which a host that logs in repeatedly needs. */
  readonly secretIdNumUses?: number;
}

export interface HostRoleHost {
  /** Short host name, e.g. `node-a`. */
  readonly name: string;
  /** Key into `classes`. */
  readonly class: string;
}

export interface HostAppRolesInput {
  readonly hosts: readonly HostRoleHost[];
  readonly classes: Readonly<Record<string, HostRoleClass>>;
}

/** Lowercase letters and digits, single hyphens between them. */
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const HOST_ROLE_SEPARATOR = '--';

/** The naming rule, in one place: `<class>--<host>`. */
export const hostRoleName = (className: string, host: string): string =>
  `${className}${HOST_ROLE_SEPARATOR}${host}`;

const classProblems = (name: string, spec: HostRoleClass): string[] => {
  const found: string[] = [];
  if (!NAME.test(name))
    found.push(`class \`${name}\` is not lowercase letters, digits, single hyphens`);
  if (spec.policies.length === 0) found.push(`class \`${name}\` has no policies`);
  if (spec.policies.includes('root')) found.push(`class \`${name}\` grants \`root\``);
  const secretId = parseDuration(spec.secretIdTtl);
  if (secretId === undefined || secretId <= 0) {
    found.push(
      `class \`${name}\` secretIdTtl \`${spec.secretIdTtl}\` must be a duration above zero ` +
        '(0 never expires)',
    );
  }
  const ttl = parseDuration(spec.tokenTtl);
  const max = parseDuration(spec.tokenMaxTtl);
  if (ttl === undefined || max === undefined) {
    found.push(`class \`${name}\` token TTLs must be durations like 15m or 1h`);
  } else if (max > 0 && ttl > max) {
    found.push(`class \`${name}\` tokenTtl is longer than tokenMaxTtl`);
  }
  return found;
};

/**
 * Every host's role props, sorted by role name. Throws, naming every problem at once, on a class or
 * host that breaks a rule above — this runs when a stack is defined, so a throw stops the plan.
 */
export const hostAppRoles = (input: HostAppRolesInput): readonly BaoAuthRoleProps[] => {
  const problems = Object.entries(input.classes).flatMap(([name, spec]) =>
    classProblems(name, spec),
  );
  /**
   * ⛔ DEDUPED ON THE ROLE NAME, NOT THE HOST NAME. A host may sit in several classes (one machine
   *   that is both a signer and a node), and each class gives it its own role: `<class>--<host>`
   *   differs, so nothing collides. Until 2026-09-21 this keyed on the host alone and refused that
   *   estate outright. What it must still refuse is the same host twice in ONE class: two
   *   declarations of one role name, so one AppRole that two resources would each claim.
   */
  const seen = new Set<string>();
  const roles: BaoAuthRoleProps[] = [];
  for (const host of input.hosts) {
    if (!NAME.test(host.name)) {
      problems.push(`host \`${host.name}\` is not lowercase letters, digits, single hyphens`);
    }
    const name = hostRoleName(host.class, host.name);
    if (seen.has(name)) {
      problems.push(`host \`${host.name}\` is listed twice in class \`${host.class}\``);
    }
    seen.add(name);
    /**
     * ⛔ OWN KEYS ONLY. `classes['constructor']` is Object's constructor, not undefined, so a host
     *   naming it passed as a class with no policies and no secretIdTtl, never checked by
     *   classProblems, and wrote a role whose secret_id never expires.
     */
    const spec = Object.hasOwn(input.classes, host.class) ? input.classes[host.class] : undefined;
    if (spec === undefined) {
      problems.push(`host \`${host.name}\` names unknown class \`${host.class}\``);
      continue;
    }
    roles.push({
      bindSecretId: true,
      name,
      secretIdNumUses: spec.secretIdNumUses ?? 0,
      secretIdTtl: spec.secretIdTtl,
      tokenMaxTtl: spec.tokenMaxTtl,
      tokenPolicies: [...new Set(spec.policies)].sort(),
      tokenTtl: spec.tokenTtl,
    });
  }
  if (problems.length > 0) {
    throw new Error(`hostAppRoles refused the input: ${problems.join('; ')}.`);
  }
  return roles.sort((a, b) => a.name.localeCompare(b.name));
};

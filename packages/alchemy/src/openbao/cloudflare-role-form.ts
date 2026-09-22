/**
 * Props, attributes and field comparison for Bao.CloudflareRole — the resource is
 * cloudflare-role.ts, the policy document rules are cloudflare-policy.ts.
 *
 * MEASURED from the engine (<estate>/platform/secrets/vault/plugin/cloudflare/path_roles.go) and the
 * 2026-09-14 snapshot of all 586 live roles:
 *   • A role is name, description, policies, ttl and max_ttl AND NOTHING ELSE (path_roles.go:14-20
 *     stores those; :204-210 returns them). Every snapshot read carries exactly those five keys, so
 *     `differences` below covers the whole server-side object — no unmanaged field can drift
 *     behind a green plan.
 *   • ttl and max_ttl are TypeDurationSecond (:73-80) and read back as integer seconds.
 *   • ⚠️ A WRITE MERGES, IT DOES NOT REPLACE (:117-146). The handler loads the stored role and
 *     overwrites only the fields present — the opposite of the proxmox engine, where an omitted
 *     field is zeroed. writeBody sends all four anyway, so a write always lands the whole
 *     declaration and can never leave an old description behind a new policy.
 *
 * ⛔ NO SECRET IN PROPS OR ATTRIBUTES, AND THERE IS NONE TO LEAK. A role is permission-group IDs, a
 *   zone or account resource, a sentence and two TTLs. The parent token lives at `<mount>/config`
 *   and a minted token at `<mount>/creds/<name>`; nothing in this family reads either path. Keep
 *   it that way — Alchemy persists attributes unencrypted (see policy.ts).
 */
import {
  type ResolvedPolicy,
  type WirePolicy,
  parseLivePolicies,
  policiesJson,
  samePolicies,
} from './cloudflare-policy.ts';
import type { DeclaredPolicy } from './cloudflare-roles-expand.ts';
import { sha256 } from './digest.ts';
import { mountPath, parseDuration } from './mount-form.ts';

export interface BaoCloudflareRoleProps {
  /** Mount of the Cloudflare secrets engine, e.g. `cloudflare-<account>-dns`. */
  mount: string;
  /** Role name. ⛔ Consumers mint by it — see cloudflare-roles-expand.ts before changing one. */
  name: string;
  /** The description as written: a zone role's carries its ` (zone: <name>)` suffix. */
  description: string;
  /** Default lease TTL, e.g. `5m`. */
  ttl: string;
  /** Maximum lease TTL, e.g. `1h`. */
  maxTtl: string;
  /**
   * Policy entries, groups by NAME. The provider resolves them through CloudflarePermissionGroups
   * at diff and reconcile time; an ID is never a prop, so a plan can never persist a guessed one.
   */
  policies: DeclaredPolicy[];
}

export interface BaoCloudflareRoleAttributes {
  mount: string;
  name: string;
  description: string;
  /** Live ttl in seconds, as the engine stores it. */
  ttl: number;
  /** Live max_ttl in seconds. */
  maxTtl: number;
  /** Live `policies` JSON — group IDs and a resource, never a credential. */
  policies: string;
  /** SHA-256 of the fields above — safe to persist; see policy.ts. */
  digest: string;
}

/** One live role, as a read returns it. */
export interface LiveCloudflareRole {
  readonly name: string;
  readonly description: string;
  readonly ttl: number | undefined;
  readonly maxTtl: number | undefined;
  readonly policiesText: string;
  /** Undefined when `policies` is not a policy document — see parseLivePolicies. */
  readonly policies: readonly WirePolicy[] | undefined;
}

export interface RoleDifference {
  readonly field: 'description' | 'max_ttl' | 'policies' | 'ttl';
  readonly want: string;
  readonly have: string;
}

/** `cloudflare-<account>-dns/roles/example-dns-read` — read, write and delete use it. */
export const rolePath = (mount: string, name: string) => `${mountPath(mount)}/roles/${name}`;

const seconds = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** A read's `data`, shaped. Lenient on purpose: a malformed field compares unequal, loudly. */
export const liveRoleOf = (data: Readonly<Record<string, unknown>>): LiveCloudflareRole => ({
  description: typeof data['description'] === 'string' ? data['description'] : '',
  maxTtl: seconds(data['max_ttl']),
  name: typeof data['name'] === 'string' ? data['name'] : '',
  policies: parseLivePolicies(data['policies']),
  policiesText: typeof data['policies'] === 'string' ? data['policies'] : '',
  ttl: seconds(data['ttl']),
});

/**
 * ⚠️ Every value is taken from `live`, the prop only standing in for a missing `name` — the same
 *   split the sibling families use, so a read never launders the declaration back as "current".
 */
export const attributesOf = (
  props: Pick<BaoCloudflareRoleProps, 'mount' | 'name'>,
  live: LiveCloudflareRole,
): BaoCloudflareRoleAttributes => {
  const attrs = {
    description: live.description,
    maxTtl: live.maxTtl ?? 0,
    mount: mountPath(props.mount),
    name: live.name || props.name,
    policies: live.policiesText,
    ttl: live.ttl ?? 0,
  };
  return { ...attrs, digest: sha256(JSON.stringify(attrs)) };
};

/**
 * Why reconcile must refuse this declaration, or undefined.
 *
 * ⛔ AN UNPARSEABLE TTL IS A REFUSAL, NOT A ZERO: it can never equal the live seconds, so it would
 *   plan `update` forever. ⛔ AN EMPTY POLICY LIST OR AN ENTRY WITH NO GROUPS IS A REFUSAL TOO — the
 *   engine rejects both (path_roles.go:147-149, :175-180), and saying so before the write names the
 *   declaration instead of quoting the server.
 */
export const refusalOf = (props: BaoCloudflareRoleProps): string | undefined => {
  const bad = [
    ...(parseDuration(props.ttl) === undefined ? [`ttl=${props.ttl}`] : []),
    ...(parseDuration(props.maxTtl) === undefined ? [`maxTtl=${props.maxTtl}`] : []),
  ];
  if (bad.length > 0) return `unparseable duration ${bad.join(', ')} (use 30s / 5m / 1h / 1d)`;
  if (props.policies.length === 0) return 'no policy entries';
  if (props.policies.some((policy) => policy.groups.length === 0)) return 'a policy with no groups';
  return undefined;
};

/**
 * The body for `PUT <mount>/roles/<name>` — the four `k=v` pairs apply-roles.py:157-162 sent.
 *
 * ★ THE TTLs GO AS THE DECLARED TEXT (`5m`), which is what `bao write ttl=5m` put in the JSON body,
 *   and TypeDurationSecond parses it server-side. `policies` is a string because the field is a
 *   string (path_roles.go:67-68), not because the engine wants the whole body stringly-typed.
 */
export const writeBody = (props: BaoCloudflareRoleProps, policies: readonly WirePolicy[]) => ({
  description: props.description,
  max_ttl: props.maxTtl,
  policies: policiesJson(policies),
  ttl: props.ttl,
});

const sameTtl = (want: string, have: number | undefined) => {
  const wantSeconds = parseDuration(want);
  return wantSeconds !== undefined && wantSeconds === have;
};

/**
 * Every field where live differs from the resolved declaration. Empty means noop.
 *
 * ⛔ apply-roles.py --verify COMPARED NONE OF THESE. It lists `<mount>/roles` and reports names
 *   only: MISSING when roles.yaml has a role the vault lacks, UNTRACKED for the reverse
 *   (apply-roles.py:136-141, :167-173, :179-185). It never read a role. So this equality is new: the
 *   four fields --apply WRITES (apply-roles.py:157-162), compared the way the engine reads them back
 *   — durations as seconds, description exactly, policies by the rules in samePolicies.
 */
export const differences = (
  props: Pick<BaoCloudflareRoleProps, 'description' | 'maxTtl' | 'ttl'>,
  policies: readonly ResolvedPolicy[],
  live: LiveCloudflareRole,
): RoleDifference[] => {
  const out: RoleDifference[] = [];
  if (props.description !== live.description) {
    out.push({ field: 'description', have: live.description, want: props.description });
  }
  if (!sameTtl(props.ttl, live.ttl)) {
    out.push({ field: 'ttl', have: String(live.ttl), want: props.ttl });
  }
  if (!sameTtl(props.maxTtl, live.maxTtl)) {
    out.push({ field: 'max_ttl', have: String(live.maxTtl), want: props.maxTtl });
  }
  if (live.policies === undefined || !samePolicies(policies, live.policies)) {
    out.push({ field: 'policies', have: live.policiesText, want: policiesJson(policies) });
  }
  return out;
};

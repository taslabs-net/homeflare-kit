/**
 * The provisioning baseline: the access every PVE cluster and node needs before a stack built on
 * this package can manage it — one role, the users OpenBao mints tokens for, the group that fences
 * the mint, and the grants that bind them. ONE description, read by both halves:
 *   · provision-declare.ts turns it into `Proxmox.Role`/`Group`/`User`/`Acl` resources, so a stack
 *     adopts the baseline and keeps it (drift is a plan, not a 403 weeks later);
 *   · provision-bootstrap.ts turns it into the one-time root commands for a NEW cluster or node.
 * The two cannot drift apart because neither holds a name or a privilege of its own.
 *
 * ⛔ THE PROVISION LANE CANNOT CREATE ITSELF. Every write here runs as a token OpenBao mints for the
 *   provision user, and minting needs that user to exist, in the mint group, bound to this role.
 *   So a new cluster is bootstrapped ONCE by root@pam with the generated commands, and the stack
 *   then adopts what they made (docs/provision-baseline.md).
 *
 * ★ ONE PRIVILEGE LIST FOR EVERY FAMILY, NOT A ROLE PER RESOURCE. The list is what the families'
 *   reconciles need, unioned — the set a hand-kept provision role reached one 403 at a time, each
 *   step recorded where it was hit (pool.ts, sdn-vnet.ts, ha-rule.ts). It includes what the lane needs
 *   to manage THIS baseline (`Sys.Modify` for the role, `Realm.AllocateUser`/`User.Modify` for the
 *   users, `Group.Allocate`, `Permissions.Modify` for the grants), so declaring it can never narrow
 *   the lane out of its own repair (role.ts: "A ROLE CAN LOCK ITS OWN PROVIDER OUT").
 * ⚠️ NOT EVERY FAMILY: root@pam-only writes (device passthrough, bind mounts — lxc-judge.ts) and
 *   privileges a family names as still missing (`VM.Replicate`, replication-job.ts) are outside it.
 */

/** The provision role's privileges, sorted — the exact set, never an addition to a live one. */
export const PROVISION_PRIVILEGES: readonly string[] = Object.freeze([
  'Datastore.Allocate',
  'Datastore.AllocateSpace',
  'Datastore.Audit',
  'Group.Allocate',
  'Mapping.Audit',
  'Mapping.Modify',
  'Permissions.Modify',
  'Pool.Allocate',
  'Pool.Audit',
  'Realm.AllocateUser',
  'SDN.Allocate',
  'SDN.Audit',
  'SDN.Use',
  'Sys.Audit',
  'Sys.Console',
  'Sys.Modify',
  'User.Modify',
  'VM.Allocate',
  'VM.Audit',
  'VM.Backup',
  'VM.Config.CPU',
  'VM.Config.Disk',
  'VM.Config.HWType',
  'VM.Config.Memory',
  'VM.Config.Network',
  'VM.Config.Options',
  'VM.PowerMgmt',
]);

/** The names a baseline uses. Every field has a generic default (`PROVISION_DEFAULTS`). */
export interface ProvisionNames {
  /** The role holding `PROVISION_PRIVILEGES` on `/`. */
  readonly role?: string | undefined;
  /** The user OpenBao's `provision` role mints tokens for, realm-qualified. */
  readonly provisionUser?: string | undefined;
  /** The group whose members OpenBao may mint for — the fence around the mint. */
  readonly mintGroup?: string | undefined;
  /** The user OpenBao's `read` role mints for, or `null` for a baseline with no read lane. */
  readonly readUser?: string | null | undefined;
  /** The role the read user holds on `/`. ⛔ It must already exist: a built-in, or one you declare. */
  readonly readRole?: string | undefined;
  /** The comment on the group and both users — how a person on the node learns what they are. */
  readonly comment?: string | undefined;
}

/** Every name, resolved: what `PROVISION_DEFAULTS` holds and what a baseline is built from. */
export type ResolvedProvisionNames = {
  readonly [K in keyof ProvisionNames]-?: Exclude<ProvisionNames[K], undefined>;
};

/** ★ Generic, kit-prefixed names: nothing here is any one estate's. */
export const PROVISION_DEFAULTS: ResolvedProvisionNames = Object.freeze({
  comment:
    'provision baseline from @homeflare/alchemy - OpenBao mints short-lived tokens for members',
  mintGroup: 'hf-mint',
  provisionUser: 'hf-provision@pve',
  readRole: 'PVEAuditor',
  readUser: 'hf-read@pve',
  role: 'HfProvisioner',
});

/** Which credential lane a user or a grant belongs to — the OpenBao role that mints for it. */
export type ProvisionLane = 'provision' | 'read';

/** A baseline, resolved: exactly what the declaration holds and the bootstrap makes. */
export interface ProvisionBaseline {
  readonly role: { readonly roleid: string; readonly privs: readonly string[] };
  readonly group: { readonly groupid: string; readonly comment: string };
  readonly users: readonly {
    readonly lane: ProvisionLane;
    readonly userid: string;
    readonly comment: string;
    readonly groups: readonly string[];
  }[];
  /** Each binds one user to one role on `/`, with propagate — the only shape the lanes need. */
  readonly grants: readonly {
    readonly lane: ProvisionLane;
    readonly userid: string;
    readonly roleid: string;
  }[];
}

/**
 * ⛔ NAMES ARE CHECKED HERE, ONCE, FOR BOTH HALVES — and conservatively. The bootstrap pastes them
 *   into a root shell, so a name that would need quoting is refused rather than quoted: PVE's own
 *   ids (`pve-roleid`, `pve-groupid`, `pve-userid`) are narrower than what a shell tolerates.
 */
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const USERID = /^[A-Za-z0-9][A-Za-z0-9._-]*@[A-Za-z][A-Za-z0-9._-]*$/;
const COMMENT = /^[A-Za-z0-9 ._,()@/+-]*$/;

const problems = (names: ResolvedProvisionNames): string[] => {
  const found: string[] = [];
  if (!ID.test(names.role)) found.push(`role \`${names.role}\` is not a PVE role id`);
  if (!ID.test(names.mintGroup)) found.push(`mintGroup \`${names.mintGroup}\` is not a group id`);
  if (!ID.test(names.readRole)) found.push(`readRole \`${names.readRole}\` is not a PVE role id`);
  for (const [field, userid] of [
    ['provisionUser', names.provisionUser],
    ['readUser', names.readUser],
  ] as const) {
    if (userid !== null && !USERID.test(userid)) {
      found.push(`${field} \`${userid}\` is not a realm-qualified user id (name@realm)`);
    }
  }
  if (names.readUser === names.provisionUser) found.push('readUser and provisionUser are one user');
  if (!COMMENT.test(names.comment))
    found.push('comment holds a character the bootstrap will not quote');
  return found;
};

/** Resolve `names` over the defaults and check them. Throws with every problem at once. */
export const provisionBaseline = (names: ProvisionNames = {}): ProvisionBaseline => {
  // ⚠️ An explicit `undefined` means "the default", not "blank": spread alone would keep it.
  const given = Object.entries(names).filter(([, value]) => value !== undefined);
  const resolved: ResolvedProvisionNames = {
    ...PROVISION_DEFAULTS,
    ...Object.fromEntries(given),
  };
  const found = problems(resolved);
  if (found.length > 0) throw new Error(`provision baseline: ${found.join('; ')}`);
  const lanes: [ProvisionLane, string, string][] = [
    ['provision', resolved.provisionUser, resolved.role],
  ];
  if (resolved.readUser !== null) lanes.push(['read', resolved.readUser, resolved.readRole]);
  return {
    grants: lanes.map(([lane, userid, roleid]) => ({ lane, roleid, userid })),
    group: { comment: resolved.comment, groupid: resolved.mintGroup },
    role: { privs: PROVISION_PRIVILEGES, roleid: resolved.role },
    users: lanes.map(([lane, userid]) => ({
      comment: resolved.comment,
      groups: [resolved.mintGroup],
      lane,
      userid,
    })),
  };
};

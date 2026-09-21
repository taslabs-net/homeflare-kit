/**
 * Wire and comparison half of Bao.ProxmoxRole — the resource itself is proxmox-role.ts.
 *
 * MEASURED 2026-09-13, read-only, against the live server (BAO_ADDR=http://127.0.0.1:8200,
 * BAO_NAMESPACE=homeflare). No write of any kind was issued to a role or a mount:
 *
 *   bao read -format=json proxmox-tb4/roles/read
 *     → { max_ttl: 21600, mint_user: "hf-read@pve",      name: "read",      ttl: 3600 }
 *   bao read -format=json proxmox-tb4/roles/provision
 *     → { max_ttl: 1800,  mint_user: "hf-provision@pve", name: "provision", ttl: 300 }
 *   GET /v1/proxmox-tb4/?help=1 → components.schemas.WriteRolesNameRequest:
 *     mint_user  string  — the ONLY required field, described as "The `user@realm` whose
 *                          standing ACL is the minted token's entire privilege set. Created
 *                          out-of-band; this engine never grants ACLs."
 *     ttl        integer — "format": "seconds"
 *     max_ttl    integer — "format": "seconds", "Narrows the mount's; can never widen it."
 *
 * ★ name + mint_user + ttl + max_ttl IS THE WHOLE ROLE. The plugin stores nothing else, so
 *   `matches` below covers 100% of the server-side state: there is no unmanaged field left to
 *   drift behind a green plan. That completeness is bought by making the TTLs REQUIRED props
 *   rather than the optional-means-unmanaged shape Bao.Mount uses — see the ⛔ on writeBody.
 */
import { sha256 } from './digest.ts';
import { mountPath, parseDuration, ttlSeconds } from './mount-form.ts';

export interface BaoProxmoxRoleProps {
  /** Mount path of the proxmox secrets engine, e.g. `proxmox-tb4`. A trailing slash is fine. */
  mount: string;
  /**
   * Role name, as `<mount>/roles/<name>` takes it.
   *
   * ⚠️ The plugin's own schema says the name "Appears in the minted token's id, so keep it
   *   short." Both live roles are one word (`read`, `provision`). A long name here becomes a
   *   long PVE token id on every mint.
   */
  name: string;
  /**
   * ⛔ THE ENTIRE SECURITY BOUNDARY OF THIS RESOURCE. A minted token inherits this PVE user's
   *   standing ACL and nothing else — the engine never grants ACLs, it only borrows one. Change
   *   this string and every credential the role issues from then on carries a different
   *   privilege set, with no other field in the declaration changing to hint at it. That is why
   *   it is compared in `matches` below, and why reconcile refuses to move it without
   *   `allowMintUserChange`.
   */
  mintUser: string;
  /** Default lease TTL for minted tokens, e.g. `1h`. REQUIRED — see the ⛔ on writeBody. */
  ttl: string;
  /**
   * Maximum lease TTL, e.g. `6h`. REQUIRED — see the ⛔ on writeBody.
   *
   * ⚠️ "Narrows the mount's; can never widen it." A role declaring `6h` under a mount whose
   *   max_lease_ttl is `1h` still READS BACK as 21600, so this resource reports noop and the
   *   plan is green — while every actual mint is capped at 3600 by the mount. The role is not
   *   lying and neither is the plan; the ceiling simply lives one level up. If a consumer gets
   *   a shorter lease than declared here, check `bao read sys/mounts/<mount>` before touching
   *   the role.
   */
  maxTtl: string;
  /**
   * Permission to re-scope `mintUser` on an EXISTING role: set it to the CURRENT live mint_user
   * that this change is allowed to replace.
   *
   * ★ IT IS A STRING AND NOT A BOOLEAN, AND THAT IS THE WHOLE POINT. A `true` left behind after
   *   one legitimate rename would wave through every future re-scope of that role forever —
   *   including one pasted in by whoever copies this block as a template. Naming the value being
   *   replaced makes the permission SELF-EXPIRING: the moment the change lands, live equals
   *   `mintUser`, the guard stops consulting it, and the next re-scope finds a stale string that
   *   does not match live and is refused on its own merits.
   *
   * Not persisted, not in attributes, not in `matches` — it describes the operator's intent, not
   * the server, so changing it alone is correctly a noop. See the ⛔ in proxmox-role.ts reconcile.
   */
  allowMintUserChange?: string;
}

export interface BaoProxmoxRoleAttributes {
  /** Mount path, trailing slash stripped. */
  mount: string;
  /** Role name. */
  name: string;
  /** The PVE `user@realm` live tokens are minted under. A name, never a credential. */
  mintUser: string;
  /** Live default lease TTL, rendered back into the duration shape props use. */
  ttl: string;
  /** Live maximum lease TTL, same shape. */
  maxTtl: string;
  /** SHA-256 of the managed fields — safe to persist; see policy.ts. */
  digest: string;
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/**
 * Seconds back into the duration shape the props use.
 *
 * ⚠️ Third private copy of this function in the package (mount-form.ts and auth-role-form.ts
 *   each keep one). Exporting a single copy means editing a file this change does not own, so
 *   it is duplicated deliberately rather than silently. Worth collapsing in a follow-up.
 */
const ttlText = (seconds: number | undefined, fallback = '0') => {
  if (seconds === undefined) return fallback;
  if (seconds % 86400 === 0) return `${String(seconds / 86400)}d`;
  if (seconds % 3600 === 0) return `${String(seconds / 3600)}h`;
  if (seconds % 60 === 0) return `${String(seconds / 60)}m`;
  return `${String(seconds)}s`;
};

/** `proxmox-tb4/roles/read` — read, write and delete all address the role here. */
export const rolePath = (mount: string, name: string) => `${mountPath(mount)}/roles/${name}`;

export const attributesOf = (
  props: Pick<BaoProxmoxRoleProps, 'mount' | 'name'>,
  live: Record<string, unknown>,
): BaoProxmoxRoleAttributes => {
  const attrs = {
    mount: mountPath(props.mount),
    // ⚠️ The plugin echoes `name` in a role read, so it is taken from `live` with the prop only
    //   as a fallback. Every other value below is live-only: the same split the sibling
    //   resources use, so a read never launders a declaration back into itself as "current".
    name: text(live['name']) || props.name,
    mintUser: text(live['mint_user']),
    ttl: ttlText(ttlSeconds(live['ttl'])),
    maxTtl: ttlText(ttlSeconds(live['max_ttl'])),
  };
  return { ...attrs, digest: sha256(JSON.stringify(attrs)) };
};

/**
 * The body for `PUT <mount>/roles/<name>` — all strings, the `k=v` pairs `bao write` sent — or
 * the prop names whose duration would not parse.
 *
 * ⛔ EVERY WRITE CARRIES ALL THREE FIELDS, and both TTLs are required props, so `matches` covers
 *   the whole role and no field is left unmanaged behind a green plan.
 * ⚠️ CORRECTED 2026-09-21 FROM THE PLUGIN SOURCE. This said a write REPLACES the role and resets an
 *   omitted TTL to zero. The port in homeflare-openbao-plugins (secrets/proxmox/path_roles.go,
 *   pathRolesWrite, commit 0e79154) MERGES: it loads the stored role and sets only the fields
 *   present (`d.GetOk`). An omitted TTL would keep its old value, which is still a value this
 *   resource would not be managing. The build running live was not re-checked against that source.
 *
 * ⚠️ Seconds go on the wire as integers, not as `1h`. The schema declares both TTLs
 *   `"format": "seconds"`, and an integer is accepted unambiguously by every path that reads
 *   them back — which is what keeps the round-trip through `matches` stable.
 */
export const writeBody = (
  props: BaoProxmoxRoleProps,
): { ok: true; body: Record<string, string> } | { ok: false; bad: string[] } => {
  const ttl = parseDuration(props.ttl);
  const maxTtl = parseDuration(props.maxTtl);
  const bad: string[] = [];
  if (ttl === undefined) bad.push(`ttl=${props.ttl}`);
  if (maxTtl === undefined) bad.push(`maxTtl=${props.maxTtl}`);
  if (ttl === undefined || maxTtl === undefined) return { ok: false, bad };
  return {
    ok: true,
    body: { mint_user: props.mintUser, ttl: String(ttl), max_ttl: String(maxTtl) },
  };
};

/**
 * ⚠️ An unparseable declaration never equals anything, so it surfaces as an update that will
 *   never settle rather than as a false noop. reconcile turns that loop into one named error;
 *   see the `writeBody` refusal there.
 */
const sameTtl = (want: string, have: string) => {
  const wantSeconds = parseDuration(want);
  const haveSeconds = ttlSeconds(have);
  return wantSeconds !== undefined && wantSeconds === haveSeconds;
};

/**
 * Why moving the role's mint user from `before` to the declared one must be refused, or undefined.
 * The ⛔ on reconcile in proxmox-role.ts says why a re-scope needs `allowMintUserChange`.
 *
 * ★ ONE DEFINITION FOR BOTH PLACES THAT ASK. Reconcile asks it of the live role at the same path.
 *   The diff asks it across a rename, where `before` is the role being replaced: a rename writes a
 *   brand-new role, so reconcile alone would see nothing to re-scope, and a rename would become the
 *   way around the guard.
 */
export const rescopeRefusal = (
  before: string,
  mintUser: string,
  allowMintUserChange: string | undefined,
): string | undefined =>
  before === mintUser || allowMintUserChange === before
    ? undefined
    : `re-scopes mint_user ${before} → ${mintUser}. Every token this role mints inherits ` +
      `the ACL of that PVE user. To re-scope deliberately, declare allowMintUserChange: '${before}'.`;

/** True when the live role already matches the declaration on every field the plugin stores. */
export const matches = (attributes: BaoProxmoxRoleAttributes, props: BaoProxmoxRoleProps) =>
  attributes.mintUser === props.mintUser &&
  sameTtl(props.ttl, attributes.ttl) &&
  sameTtl(props.maxTtl, attributes.maxTtl);

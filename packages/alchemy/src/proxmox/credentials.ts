/**
 * The PVE credential a reconcile runs with: minted from OpenBao, alive for five minutes.
 *
 * ⛔ THERE IS NO STATIC WRITE TOKEN IN THIS ESTATE, AND THAT IS DELIBERATE. Every PVE token stored
 *   on the estate's static KV shelf is read-only — PVEAuditor on each cluster, Audit on PBS, all
 *   as one metrics user. The MCP proxmox client says why in its own header: the auditor token bounds
 *   what a BUG can do, independently of what the code bounds. Adding a long-lived write token to
 *   that shelf would delete the outer lock for every reader of the shelf, not just for this
 *   provider.
 *
 * ★ SO WRITES COME FROM A DYNAMIC MOUNT INSTEAD, which the estate already built: `proxmox-c1/`
 *   exposes two roles — `read` (ttl 3600s) and `provision` (ttl 300s, max 1800s, NOT renewable).
 *   A mint returns a PVE API token of its own, `hf-provision@pve!hf-provision-…-<timestamp>-<id>`,
 *   which expires on its own whether or not anything cleans up. Same shape as
 *   `cloudflare-<account>-<surface>/creds/<role>`, same reason.
 *   ⚠️ THAT PATH IS WRITTEN WITH `<surface>` RATHER THAN A GLOB ON PURPOSE: a `*` followed by
 *     a slash CLOSES THIS BLOCK COMMENT, and everything below it then parses as code. It cost
 *     six TS1005/TS1443 errors pointing at innocent lines twenty rows further down.
 *
 * ⚠️ FIVE MINUTES IS THE DESIGN, NOT AN OBSTACLE. A reconcile that cannot finish inside the lease
 *   should mint again rather than ask for a longer one: the short lease is what makes a leaked
 *   token uninteresting. `provision` is explicitly non-renewable, so there is no renew path to
 *   reach for.
 *
 * ⛔ THE SECRET NEVER TOUCHES DISK, A LOG, OR ALCHEMY STATE. Alchemy persists resource attributes
 *   WITHOUT encryption — StateEncoding.ts writes `Redacted` as `{"@redacted": <plaintext>}` — and
 *   this estate's state store is the `alchemy` Postgres, which a nightly job dumps. A PVE
 *   secret that reached an attribute would outlive its 300s lease by months, in four places.
 *   Nothing here returns it to a resource; it is used to build a header and then dropped.
 */
/**
 * ★ NO SESSION, ON PURPOSE, AND THIS IS WHAT UNBLOCKED `wip/bao-policy`.
 *   `CommandExecutor.run` requires a `ScopedPlanStatusSession`, and Alchemy gives one to
 *   `reconcile` and `delete` but NOT to `read` or `diff` — so a provider built on `run` can only
 *   ever write. Alchemy's OWN Docker provider does not use `CommandExecutor` for this at all: it
 *   takes `ChildProcessSpawner` and pipes `ChildProcess.make(...)` through `spawner.spawn`, which
 *   needs a `Scope` and nothing else (Docker.ts:476-553). That was the pattern here until
 *   2026-09-14, when `mint` moved to `HttpClient` — which needs no session either, so `mint` is
 *   still callable from all four operations.
 *
 * ⛔ DO NOT SATISFY THE OLD SIGNATURE BY FAKING A SESSION. A session carries plan status Alchemy
 *   uses to report progress; inventing one would make read and diff report work they are not doing.
 */
/** Which role a call needs. `read` for read/diff, `provision` for reconcile/delete. */
export type PveRole = 'read' | 'provision';

/**
 * Where credentials come from, and which cluster they are for.
 *
 * ⚠️ A PARAMETER, NOT A CONSTANT, SO THIS PACKAGE CAN LEAVE THE ESTATE. Everything
 *   HomeFlare-specific — the mount name, the API host — belongs in the stack that declares
 *   resources, not in the provider. Anyone with an OpenBao mount that vends Proxmox API tokens can
 *   use this file unchanged; that is the whole difference between a provider and a script.
 */
export type PveTarget = {
  /** OpenBao mount that vends API tokens for this host, e.g. `proxmox-c1`. */
  readonly mount: string;
  /**
   * mgmt hostnames for cluster members, e.g. `node-b.mgmt.example.com`. Any member's :8006 API
   * manages the whole cluster; `client.ts` failovers across them.
   */
  readonly members: readonly string[];
  /**
   * Which product answers at `api`. Defaults to `pve`.
   *
   * ★ PBS IS THE SAME CLIENT WITH A DIFFERENT AUTHORIZATION HEADER, AND THAT IS WHY THERE IS NO
   *   SECOND CLIENT HERE. Proxmox Backup Server speaks the same `/api2/json` paths, wraps every
   *   answer in the same `{"data": …}` envelope, and its OpenBao mount vends the same
   *   `{token_id, secret}` shape — so `mint`, `pve()` and `pveOperations` all work against it
   *   unchanged. The ONE difference is the header scheme: PVE spells it
   *   `PVEAPIToken=<id>=<secret>` and PBS spells it `PBSAPIToken=<id>:<secret>` — a different
   *   prefix AND a different separator.
   *
   * ⛔ IT IS REQUIRED, NOT OPTIONAL, AND THAT IS THE WHOLE TYPE-SAFETY ARGUMENT. A PBS target and
   *   a PVE target are the same two strings, so with an OPTIONAL discriminant TypeScript's
   *   structural typing would accept a PBS host wherever a PVE one belongs — and `pve()` would
   *   then build `PVEAPIToken=<id>=<secret>` against a server wanting
   *   `PBSAPIToken=<id>:<secret>`. Every call 401s, `pveOperations.read` folds that into "absent",
   *   the plan says CREATE for an object that is plainly there, the POST is refused, and not one
   *   symptom points at the header. Required, the mistake is a compile error instead.
   *
   * ⚠️ REASONED FROM PBS'S DOCUMENTED SCHEME, NOT MEASURED. The estate has no PBS credential yet
   *   (there is no PBS mount in OpenBao), and an unauthenticated probe cannot tell the schemes
   *   apart — `https://pbs.example.com:8007/api2/json/nodes` answers 401 to a missing header, a
   *   PVE-shaped one and a PBS-shaped one alike. The first real token will confirm or correct it,
   *   and a wrong guess fails closed with a 401 rather than doing something odd.
   */
  readonly scheme: 'pve';
};

/** The same client against a Proxmox Backup Server. See the ⛔ on `scheme` above. */
export type PbsTarget = {
  readonly mount: string;
  readonly api: string;
  readonly scheme: 'pbs';
};

/** Either product. What `pve()` and `pveOperations` accept; what a RESOURCE accepts is narrower. */
export type ApiTarget = PbsTarget | PveTarget;

/**
 * What a mint returns.
 *
 * ⚠️ `secret` IS PRESENT AND MUST NOT BE PERSISTED. It is typed as a plain string rather than
 *   `Redacted` on purpose: Alchemy's Redacted is a STATE-ENCODING marker, not encryption, so
 *   wrapping it would imply a protection that does not exist. The protection here is that this
 *   value never leaves the function that builds the Authorization header.
 */
export type PveCredential = {
  /** `hf-provision@pve!hf-provision-…` — an identifier, safe to log. */
  readonly tokenId: string;
  /** ⛔ NEVER LOG, NEVER PERSIST, NEVER RETURN FROM A RESOURCE. */
  readonly secret: string;
  /** Seconds the lease was granted for, as reported by OpenBao. */
  readonly leaseSeconds: number;
};

/** The environment `mint` resolves OpenBao from — `process.env` unless a test passes its own. */
export type BaoEnvironment = Readonly<Record<string, string | undefined>>;

// ★ `mint` and `authorization` live in mint.ts (2026-09-24) — this file is types only now, to
//   stay under the 250-line cap once `PveCredentialDenied`'s catchers needed a real header. See
//   mint.ts's own header. Importers: mint.ts, client.ts, lease-cache.ts, lxc-lifecycle.ts,
//   network-apply.ts, credentials.test.ts.

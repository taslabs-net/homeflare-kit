/**
 * WHAT A PVE OBJECT DECLARES: one shape for every one of them, so the provider can cover Proxmox
 * rather than a corner of it. The four operations that read this spec are in resource.ts.
 *
 * ⛔ THE ALTERNATIVE IS TWENTY COPIES OF THE SAME 130 LINES. Proxmox exposes LXC, QEMU, storage,
 *   pools, users, groups, roles, ACLs, API tokens, SDN zones/vnets/subnets, firewall rules and
 *   groups, HA resources, backup and replication jobs, metric servers and notification targets.
 *   Each is the same four operations over a different path and a different form body. Written by
 *   hand, resource number six is where someone quietly drops the read-back or the isResolved guard
 *   and nobody notices until a plan lies.
 *
 * ★ SO THE FOUR OPERATIONS LIVE HERE, ONCE, AND A RESOURCE DECLARES ONLY WHAT IS DIFFERENT:
 *   where it lives, how to recognise it, and which fields are mutable. A new PVE object should be
 *   thirty lines, not a hundred and thirty.
 *
 * ⚠️ EVERY PVE ANSWER IS WRAPPED IN `{"data": ...}` AND A FAILED CALL CAN STILL BE HTTP 200 with
 *   `{"data": null}`. That is why `reconcile` below READS BACK and refuses when the object is still
 *   absent, rather than trusting a status code — see the ⛔ in that function.
 */
import type * as HttpClient from 'effect/unstable/http/HttpClient';
import type { PveForm } from './client.ts';
import type { EndpointKey } from './constraints.ts';
import type { ApiTarget, PbsTarget, PveRole, PveTarget } from './credentials.ts';

/**
 * ★ WHY SEVERAL FAMILIES HERE DECLARE `defaultRemovalPolicy: 'retain'`, WRITTEN ONCE.
 *
 *   Alchemy's own convention: a few resource types default to retain "because their contents are
 *   irreplaceable" — `GitHub.Repository` and `Cloudflare.Zone` do — and those opt into deletion
 *   with `destroy()`. `retain` means the engine SKIPS `provider.delete` entirely when a resource
 *   is orphaned or destroyed: the state row is dropped, the cluster object lives on.
 *
 *   So the PVE families whose contents cannot be rebuilt from a line of TypeScript — CephOsd,
 *   CephPool, CephFs, CephDaemon, ZfsPool, Storage, NodeNetwork — carry that default. Their
 *   `delete` is FULLY IMPLEMENTED and runs the moment a caller opts in with
 *   `.pipe(RemovalPolicy.destroy())`. This is deliberately the Terraform `prevent_destroy` shape
 *   rather than a stubbed-out operation: a `delete` that silently does nothing lies to whoever is
 *   reading the plan, and the lie is discovered at the worst possible time.
 *
 * ⚠️ THE POLICY IS A DECORATION, NOT A PROP, so changing it produces NO DIFF — the resource plans
 *   as a noop and the deploy re-commits the row's policy in place. A policy change therefore takes
 *   effect from the very next deploy even though the plan shows nothing.
 */

/**
 * ⛔ A RESOURCE IS PINNED TO ITS PRODUCT; ONLY THE FACTORY TAKES EITHER. The two hosts are the same
 *   two strings, so without a required discriminant TypeScript would accept a PBS host wherever a
 *   PVE one belongs — silently, with every call 401ing and `read` folding that into "absent". The
 *   whole argument is on `scheme` in credentials.ts.
 */
/**
 * ★ WHAT EVERY OPERATION IN THIS PACKAGE NEEDS FROM THE RUNTIME, NAMED ONCE.
 *
 *   `HttpClient`, for both halves of every call: the credential is minted from OpenBao's HTTP API
 *   and the PVE call goes through the same client. That is what Alchemy's own providers do
 *   (src/Hetzner/Providers.ts builds on `FetchHttpClient.layer`, and there is no bare `fetch` in
 *   its Docker, Kubernetes or GitHub providers).
 * ★ `ChildProcessSpawner` WAS HERE UNTIL 2026-09-14, while the mint shelled out to `bao`. The HTTP
 *   client replaced that (credentials.ts), so the requirement went with it.
 *
 * ⚠️ SPELLED OUT AT EACH OF THE FORTY-ODD RESOURCES this would be a union nobody keeps in step —
 *   one file left on the old shape is a type error at the stack, far from the cause. Named here,
 *   adding a third service later is one edit.
 */
export type PveRequirements = HttpClient.HttpClient;

export type WithTarget = { target: PveTarget };
export type WithPbsTarget = { target: PbsTarget };
export type WithApiTarget = { target: ApiTarget };

export type PveSpec<Props extends WithApiTarget, Attributes> = {
  /** `pools/lab`, `nodes/node-b/lxc/101` — where ONE object is read, updated and deleted. */
  readonly path: (props: Props) => string;
  /** `pools`, `nodes/node-b/lxc` — where a NEW one is POSTed. */
  readonly collection: (props: Props) => string;
  /** Live JSON to attributes. Returning undefined means "this is not really there". */
  readonly attributes: (live: Record<string, unknown>, props: Props) => Attributes | undefined;
  /** The form PVE wants on create. ⚠️ PVE takes form encoding, not JSON. Arrays: client.ts. */
  readonly createForm: (props: Props) => PveForm;
  /**
   * The form for an update, or undefined when the object has no mutable fields.
   *
   * ⚠️ SOME PVE OBJECTS CANNOT BE UPDATED AT ALL. Returning undefined makes a changed prop a
   *   REPLACE rather than a silent no-op, which is the honest answer for an immutable object.
   */
  readonly updateForm?: (props: Props) => PveForm;
  /** True when live already matches props. Decides noop vs update. */
  readonly matches: (attributes: Attributes, props: Props) => boolean;
  /**
   * Which lease reads this family. Defaults to `read`, the 3600s auditor-shaped one.
   *
   * ⛔ THREE FAMILIES SET THIS TO `provision`, AND THE FAILURE IT AVOIDS IS SILENT. PVE gates some
   *   SINGLE-OBJECT reads on the allocate privilege rather than the audit one — `/storage/{id}`,
   *   `/cluster/sdn/zones/{zone}`, `/cluster/sdn/vnets/{vnet}` — while their COLLECTION reads
   *   accept audit, so nothing looks wrong until a resource reads one object. `read` below folds
   *   every failure into `undefined`, right for a 404 and wrong for a 403, so the plan says create
   *   and PVE answers that the object already exists. Measured both ways on `local`, and written
   *   up with the alternative that was rejected, in docs/privileges.md.
   */
  readonly readRole?: PveRole;
  /**
   * The vendor endpoints this family writes, as the generated tables key them —
   * `'pbs:POST /config/verify'`, `'pve:PUT /cluster/sdn/zones/{zone}'`.
   *
   * ⛔ DECLARING IT IS WHAT MAKES THE VENDOR'S OWN LIMITS RUN AT PLAN TIME. Without it the family
   *   behaves exactly as it did on 2026-09-22, when `deploy:pbs` adopted ten objects and then
   *   failed its one create on a `maxLength` PBS publishes and our generated `comment?: string`
   *   does not carry. `codegen/constraints.ts` scans this package for these strings, so a key that
   *   names an endpoint the vendor does not have stops the GENERATOR rather than a deploy.
   * ⚠️ The spelling is the vendor's own path TEMPLATE, braces and all — not `spec.path(props)`,
   *   which has the ids substituted in.
   *
   * ⚠️ A FUNCTION FOR THE TWO FAMILIES WHOSE ENDPOINT IS CHOSEN BY A PROP, AND FOR NO OTHER
   *   REASON. `Proxmox.NotificationTarget` POSTs to one of four `endpoints/{type}` paths and
   *   `Proxmox.CephDaemon` to one of `ceph/mds|mgr|mon`, each with its own parameter schema, so a
   *   single key would table the wrong rules for three declarations out of four.
   *   ⛔ EVERY KEY THE FUNCTION CAN RETURN STILL HAS TO EXIST AS A LITERAL IN THIS PACKAGE'S
   *     SOURCE. `codegen/constraints.ts` finds keys by scanning text, so a key assembled from a
   *     template literal is tabled by nothing and `constraintsFor` throws on the deploy that first
   *     reaches it. Write the keys out in a record and index it — see `ceph-endpoints.ts`.
   */
  readonly endpoint?: EndpointPair | ((props: Props) => EndpointPair);
};

/** The two endpoints a family writes. Either may be absent — see `PveSpec['endpoint']`. */
export type EndpointPair = {
  readonly create?: EndpointKey;
  readonly update?: EndpointKey;
};

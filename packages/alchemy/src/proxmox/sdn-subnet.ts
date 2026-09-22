/**
 * `Proxmox.SdnSubnet` — the addresses on a declared bridge: the CIDR, its gateway, its DHCP pool.
 *
 * ★ THE THIRD LINK OF ONE CHAIN, AND THE ORDER IS DATA FLOW RATHER THAN CONVENTION. A subnet
 *   belongs to a vnet and a vnet belongs to a zone. MEASURED and recorded in sdn-vnet.ts: creating
 *   a vnet is permission-checked at `/sdn/zones/-`, so a missing zone surfaces as a PERMISSION
 *   error rather than as "no such zone". One level deeper the same shape holds — PVE's
 *   `check_vnet_access` looks the vnet's ZONE up and checks `/sdn/zones/<zone>/<vnet>` — so a
 *   subnet declared against a vnet that does not exist yet dies inside that lookup, with the vnet
 *   named and the zone not. Pass the zone and vnet resources' OWN attributes into `zone` and
 *   `vnet`; a literal buys no ordering, and here it also buys a wrong path.
 *
 * ⛔ THE ID PVE FILES A SUBNET UNDER IS NOT THE ONE YOU WRITE, AND IT IS THIS FAMILY'S SHARPEST
 *   EDGE. `POST` takes `subnet=10.0.0.0/24` while GET, PUT and DELETE address `lab-10.0.0.0-24`.
 *   One PVE parameter name, `subnet`, carrying two different values — so they are named APART here,
 *   `cidr` for the declared one and `subnetId` for the derived one, for the reason values.ts gives
 *   about `flag`: a name that means two things is a bug waiting for whoever reads one meaning. The
 *   derivation, and its measurement, live in `subnetId` in sdn-subnet-form.ts.
 *
 * ⛔ WHICH IS WHY `zone` IS A PROP THOUGH PVE NEVER ACCEPTS IT ON A SUBNET WRITE. The path cannot
 *   be built without it and it is knowable only from the VNET. Declare the wrong zone and the id is
 *   wrong: the POST still succeeds, because PVE computes the real id itself from the vnet, and the
 *   read-back then looks for a subnet that is not there. The factory's guard in resource.ts DIES on
 *   that first deploy — "the write returned no error but the object is still absent" — which is
 *   loud and immediate, and much better than the alternative it replaces: a plan that says create,
 *   forever, against a subnet PVE insists is already defined.
 *
 * ⛔ SDN WRITES ARE STAGED, NOT APPLIED — the same trap as sdn-zone.ts and sdn-vnet.ts, and it
 *   walks straight through the factory's read-back, which proves the staging file and nothing more.
 *   Nothing here applies. `Proxmox.SdnApply` (sdn-apply.ts) publishes the whole staged config with
 *   `PUT /cluster/sdn`; declare one and pass this resource's `subnetId` in its `after`.
 *
 * ⛔ AND `Proxmox.SdnApply` CANNOT YET SEE A STAGED SUBNET, SO ITS PLAN WILL LIE ABOUT THIS FAMILY.
 *   MEASURED: its `COLLECTIONS` list is `cluster/sdn/zones` and `cluster/sdn/vnets`, while
 *   `PVE::Network::SDN::pending_config` keys the pending view on a SEPARATE `subnets` section of
 *   the running config. A run that stages only a subnet therefore leaves both counted collections
 *   at zero, the apply diffs as `noop`, and the subnet never reaches a node. It is NOT fixable by
 *   adding a string to that list: the subnet index is PER VNET
 *   (`cluster/sdn/vnets/{vnet}/subnets?pending=1`), so SdnApply needs the vnet names before it can
 *   count them. Until that lands, a subnet-only change needs `pvesh set /cluster/sdn` by hand.
 *
 * ★ THE READ LANE IS ENOUGH HERE, AND THAT IS A REAL DIFFERENCE FROM BOTH SIBLINGS. The zone and
 *   vnet ITEM reads are gated on SDN.Allocate, which is why each sets `readRole: 'provision'`. This
 *   one is not. MEASURED from the cluster's own schema on 2026-09-13:
 *
 *     GET /cluster/sdn/vnets/{vnet}/subnets/{subnet}
 *       -> "Require 'SDN.Audit' or 'SDN.Allocate' permissions on '/sdn/zones/<zone>/<vnet>'"
 *
 *   and `GET /access/acl` the same day shows `hf-read@pve` holding the built-in PVEAuditor — whose
 *   seven privileges include SDN.Audit — at `/` with propagate=1. So the default 3600s auditor
 *   lease reads this family, and a `readRole: 'provision'` here would be privilege nobody needed.
 *   Writes are a different answer: POST, PUT and DELETE all require SDN.Allocate on
 *   `/sdn/zones/<zone>/<vnet>`, which the provision role gained on 2026-09-13 (`PROVISION_PRIVILEGES`).
 *
 * ⚠️ NO LIVE SUBNET EXISTS ON C1 TO ROUND-TRIP AGAINST — there are no SDN zones and no vnets, so
 *   there can be no subnets. Every claim above is read off PVE 9.2.11's own schema and Perl sources
 *   on node-b, and the noop argument below rests on those rather than on a plan this file has watched.
 *
 * ⚠️ TWO REFUSALS TO EXPECT, both from `SubnetPlugin::on_update_hook`: PVE will not put a subnet on
 *   a vnet with `vlanaware` set ("you can't add a subnet on a vlanaware vnet"), and it rejects a
 *   gateway outside the CIDR unless the mask is /32. Both are create-time 400s, not drift.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import {
  type DhcpRange,
  createForm,
  declaredRanges,
  dhcpRanges,
  subnetId,
  updateForm,
} from './sdn-subnet-form.ts';
import { bool, int, text } from './values.ts';

export interface SdnSubnetProps extends WithTarget {
  /**
   * The vnet whose bridge carries these addresses. Identity AND a written field.
   *
   * ⛔ MOVING A SUBNET BETWEEN VNETS IS NOT SOMETHING THIS RESOURCE CAN DO, and the symptom is
   *   worth knowing before you meet it. The id is built from the zone and the CIDR, so it does not
   *   change; but the read goes to `.../vnets/<declared>/subnets/<id>`, and PVE answers a subnet
   *   filed under another vnet with `raise_param_exc({ vnet => "wrong vnet" })`. `read` folds that
   *   into "absent", reconcile POSTs, and PVE refuses with "sdn subnet object ID ... already
   *   defined". Loud and accurate, but it does not converge: change the vnet by removing the
   *   declaration and writing a new one.
   */
  vnet: string;
  /**
   * The zone that vnet lives in. ⚠️ PATH INPUT ONLY — PVE accepts no `zone` on a subnet write, and
   *   nothing here sends one. It is a prop because the path cannot be spelled without it.
   */
  zone: string;
  /** `10.0.0.0/24`. Identity: PVE builds the id from it, so a new CIDR is a new subnet. */
  cidr: string;
  /** Handed to guests as their default route, and registered in the zone's IPAM as `<vnet>-gw`. */
  gateway?: string;
  /**
   * Masquerade this subnet. ⚠️ INERT UNTIL THE CLUSTER FIREWALL IS ON — PVE's own description is
   *   "enable masquerade for this subnet if pve-firewall", and C1's cluster firewall was empty and
   *   disabled when this was written. It still round-trips, so declaring it does not diff.
   */
  snat?: boolean;
  /** `adm` -> `<hostname>.adm.example.internal` for records the zone's DNS plugin registers. */
  dnszoneprefix?: string;
  /** ⚠️ WIRE NAME `dhcp-dns-server`; see the ⚠️ on `isolatePorts` in sdn-vnet.ts about mappings. */
  dhcpDnsServer?: string;
  /**
   * ⛔ ONE POOL, NOT A LIST, AND THE LIMIT IS THE CLIENT'S RATHER THAN PVE'S. `dhcp-range` is a PVE
   *   `type => 'array'` parameter, and an array reaches a form-encoded body only as a REPEATED KEY
   *   — which `client.ts` cannot express, because `pve()` takes `Record<string, string>` and one
   *   key holds one value. A single occurrence works today because `PVE::RESTHandler`'s
   *   `$normalize_legacy_param_formats` wraps a scalar into `[$value]` for an array parameter, so
   *   the type is declared as one range and a second one is unspellable rather than silently lost.
   * ⛔ THAT COERCION IS MARKED FOR REMOVAL. Its own comment in RESTHandler.pm reads "mark the
   *   behaviour deprecated with 9.x, and remove it with 10.x", and this cluster runs 9.2.11 — so on
   *   PVE 10 every write carrying a range becomes a hard 400. The fix is not here: it is a form
   *   type in client.ts that admits repeated keys.
   * ⚠️ A LIVE SUBNET CARRYING TWO POOLS IS THEREFORE NARROWED TO ONE by the first deploy that
   *   declares one. `matches` compares the WHOLE live list, so the narrowing is visible in the plan
   *   as an update rather than happening quietly, and it converges.
   */
  dhcpRange?: DhcpRange;
}

/**
 * ⛔ NO `digest` HERE, for the reason sdn-zone.ts gives: PVE returns the digest of the WHOLE
 *   subnets.cfg, so declaring a SECOND subnet would rewrite this one's stored attributes and
 *   comparing it would report an update on a subnet nobody touched.
 */
export interface SdnSubnetAttributes {
  /** `<zone>-<network>-<mask>` — the path segment, and the name to use in `pvesh`. */
  subnetId: string;
  vnet: string;
  zone: string;
  /** `10.0.0.0/24`, as PVE reassembles it from the id. */
  cidr: string;
  /** Prefix length, so a guest's `ip=10.0.0.5/24` can be built from a reference. */
  mask: number;
  gateway: string;
  snat: boolean;
  dnszoneprefix: string;
  dhcpDnsServer: string;
  /** Normalised and sorted — never compare a raw PVE value to it. See `dhcpRanges`. */
  dhcpRange: string;
  /** ⚠️ THE REMINDER IN THE STATE ITSELF: staged config. No value here says a node has the subnet. */
  readonly staged: true;
}

export interface ProxmoxSdnSubnet extends Resource<
  'Proxmox.SdnSubnet',
  SdnSubnetProps,
  SdnSubnetAttributes,
  never,
  PveRequirements
> {}

/**
 * ⚠️ NO `defaultRemovalPolicy: 'retain'`, UNLIKE THE SEVEN FAMILIES THAT CARRY IT, AND THE ★ IN
 *   resource.ts IS THE TEST IT FAILS: a subnet's whole content is a CIDR, a gateway and a pool,
 *   which a line of TypeScript rebuilds exactly. The part that is NOT rebuildable is the guest
 *   addresses the zone's IPAM handed out, and PVE guards that itself — MEASURED in the built-in
 *   `pve` IPAM plugin, which answers a delete with "cannot delete subnet '<cidr>', not empty"
 *   whenever anything beyond the gateway still holds an address. That refusal is surfaced as-is.
 */
export const ProxmoxSdnSubnet = Resource<ProxmoxSdnSubnet>('Proxmox.SdnSubnet');

const handlers = pveHandlers<SdnSubnetProps, SdnSubnetAttributes>({
  attributes: (live, props) => {
    /**
     * ⚠️ UNREACHABLE ON A HEALTHY CLUSTER, AND KEPT BECAUSE "UNREACHABLE" IS A FACT ABOUT TODAY'S
     *   PVE. The read handler already refuses a subnet filed under another vnet, so this row should
     *   never arrive — see the ⛔ on `vnet` above for what that refusal costs. If a future PVE
     *   answers instead of raising, reporting the foreign subnet as absent makes reconcile POST and
     *   PVE say "already defined": still loud, rather than a silent noop over somebody else's
     *   addresses.
     */
    const liveVnet = text(live['vnet']);
    if (liveVnet !== '' && liveVnet !== props.vnet) return undefined;
    return {
      cidr: text(live['cidr']),
      dhcpDnsServer: text(live['dhcp-dns-server']),
      dhcpRange: dhcpRanges(live['dhcp-range']),
      dnszoneprefix: text(live['dnszoneprefix']),
      gateway: text(live['gateway']),
      mask: int(live['mask'], 0),
      snat: bool(live['snat']),
      staged: true,
      subnetId: subnetId(props),
      vnet: props.vnet,
      zone: text(live['zone']),
    };
  },
  collection: (props) => `cluster/sdn/vnets/${props.vnet}/subnets`,
  createForm,
  /** The vendor rules both forms are checked against at plan time — resource-spec.ts. */
  endpoint: {
    create: 'pve:POST /cluster/sdn/vnets/{vnet}/subnets',
    update: 'pve:PUT /cluster/sdn/vnets/{vnet}/subnets/{subnet}',
  },
  /**
   * ⛔ FIVE REPORTED FIELDS ARE DELIBERATELY ABSENT FROM THIS COMPARISON, and each is a
   *   forever-diff if it goes back in.
   *   `subnetId`, `cidr`, `zone` and `mask` are all DERIVED BY PVE FROM THE ID — measured in
   *   `Subnets::sdn_subnets_config`, which splits the id and synthesises cidr/zone/network/mask on
   *   every read. None of the four is a POST or PUT parameter, so a difference could never be
   *   written; and since the id IS the path this read used, a difference cannot arise either — the
   *   GET would have failed and the factory would report "absent" instead.
   *   `vnet` is the FILTER that produced this row rather than a reading of it: PVE refuses to
   *   answer with a subnet on another vnet, so comparing it can only ever be true.
   *   `staged` is a fact about the cluster, not about the declaration: diffing it would report an
   *   update on every plan until somebody applied, then another the moment anyone staged anything.
   *   `digest` is not even reported — see the ⛔ above the attributes.
   */
  matches: (attributes, props) =>
    attributes.gateway === (props.gateway ?? '') &&
    attributes.snat === (props.snat === true) &&
    attributes.dnszoneprefix === (props.dnszoneprefix ?? '') &&
    attributes.dhcpDnsServer === (props.dhcpDnsServer ?? '') &&
    attributes.dhcpRange === declaredRanges(props.dhcpRange),
  /**
   * ⚠️ NO `?pending=1` AND NO `?running=1`, HOWEVER TEMPTING — the same refusal sdn-vnet.ts makes.
   *   The factory uses this one path for GET, PUT and DELETE alike, every one of those schemas
   *   declares `additionalProperties => 0`, and PVE answers an unexpected parameter on a write with
   *   "parameter verification failed". Staged-ness is documented at the top of this file instead.
   */
  path: (props) => `cluster/sdn/vnets/${props.vnet}/subnets/${subnetId(props)}`,
  updateForm,
});

/**
 * ⛔ `list` IS EMPTY LIKE EVERY OTHER RESOURCE HERE. `GET /cluster/sdn/vnets/{vnet}/subnets` answers
 *   with every subnet on that bridge, guest addresses and all; adopting one would invite Alchemy to
 *   narrow or delete a network nobody declared. Adoption stays an explicit act.
 *
 * ⛔ AND A DELETE IS STAGED TOO, WHICH IS THE HALF PEOPLE FORGET. The section leaves subnets.cfg and
 *   Alchemy drops the resource, but the gateway stays on the bridge and DHCP keeps answering until
 *   something applies `PUT /cluster/sdn`: a destroy nobody applies reads as complete in the plan and
 *   has not happened on the cluster.
 */
export const ProxmoxSdnSubnetProvider = () =>
  Provider.effect(ProxmoxSdnSubnet, Effect.succeed(ProxmoxSdnSubnet.Provider.of(handlers)));

/**
 * `Proxmox.SdnVnet` — the bridge a guest actually attaches to.
 *
 * ★ THIS IS THE OBJECT THAT CLOSES THE GAP BETWEEN A DECLARED CONTAINER AND A DECLARED NETWORK.
 *   `Proxmox.Lxc` takes `net0: name=eth0,bridge=vmbr0,ip=dhcp`, in which the bridge is a string
 *   nothing checks. A vnet's id IS the bridge PVE builds on every node of its zone, so declaring
 *   the vnet and passing its `bridge` attribute into `net0` turns that string into a reference
 *   Alchemy can order and a plan can show.
 *
 * ⚠️ MEASURED: CREATING A VNET CHECKS PERMISSION AT `/sdn/zones/-`, NOT AT THE VNET. The ACL path
 *   is the ZONE's, so a vnet whose zone does not exist yet fails as a PERMISSION error rather than
 *   as "no such zone" — and you go off widening a role that was never the problem. `zone` is
 *   therefore a hard dependency edge, not a convention: pass the zone resource's own attribute so
 *   Alchemy creates the zone first. A zone name typed in as a literal buys no ordering at all.
 *
 * ⛔ THE READ-BACK AFTER A WRITE PROVES THE STAGING FILE AND NOTHING MORE — the same trap as
 *   `sdn-zone`, and it walks straight through the factory's guard. PVE's SDN endpoints write
 *   `/etc/pve/sdn/vnets.cfg`; nothing reaches a node's `/etc/network/interfaces` until
 *   `PUT /cluster/sdn` applies the staged config. `pveOperations.reconcile` reads back and refuses
 *   when an object is absent, and a vnet that exists only on paper SATISFIES that read: reconcile
 *   reports success, the next plan says noop, and no bridge exists anywhere on the cluster.
 *   This resource does NOT issue the apply, deliberately. One vnet's reconcile cannot decide to
 *   commit every other pending SDN change in the cluster, including ones a human staged in the UI
 *   and has not finished. Apply stays an operator's act — `pvesh set /cluster/sdn`.
 *
 * ★ SUBNETS ARE A SIBLING RESOURCE, NOT A FIELD HERE. The gateway and the DHCP ranges guests take
 *   addresses from hang off `cluster/sdn/vnets/{vnet}/subnets`, which MEASURED refuses a POST that
 *   omits `type` or `subnet` ("parameter verification failed"). Same factory, one path deeper, and
 *   it depends on this resource the way this one depends on the zone.
 *
 * ⛔ read/diff NEED SDN.Allocate TOO, NOT SDN.Audit — corrected 2026-09-13 against the cluster's
 *   schema. `GET /cluster/sdn/vnets/{vnet}` is checked against SDN.Allocate exactly as the zone
 *   item endpoint is, while only the COLLECTION read accepts SDN.Audit. An auditor-shaped `read`
 *   lease is therefore refused, and `pveOperations.read` turns that refusal into "absent" rather
 *   than an error — see the ⛔ in sdn-zone.ts and docs/privileges.md.
 *
 * ⚠️ PRIVILEGES, AND THE ESTATE'S CREDENTIAL HELD NONE OF THEM UNTIL 2026-09-13. reconcile and
 *   delete mint `provision` and need SDN.Allocate on `/sdn/zones`, or on the one zone if scoped. `LXCProvisioner` grants
 *   SDN.Use, which is what a GUEST needs in order to attach to a vnet and NOT what creating one
 *   needs, so a container declared on this vnet works today while the vnet itself 403s. Widen
 *   deliberately, the way Pool.Allocate was:
 *   `pveum role modify LXCProvisioner --privs "<existing>,SDN.Allocate,SDN.Audit"` over SSH,
 *   preserving every existing privilege.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { bool, withClears } from './values.ts';

export interface SdnVnetProps extends WithTarget {
  /**
   * ⛔ THE PRIMARY KEY AND THE BRIDGE NAME AT ONCE. PVE caps it at eight alphanumeric characters
   *   because it becomes a real interface on every node in the zone. There is no rename: a new id
   *   is a new bridge, and every guest whose `net0` still names the old one stays on the old one.
   */
  vnet: string;
  /**
   * The SDN zone that owns it. Mutable — a vnet can be moved between zones — but see the ⚠️ at the
   * top of this file: the zone has to exist first, and passing a zone resource's attribute instead
   * of a literal is the only thing that makes Alchemy order them.
   */
  zone: string;
  /** Free text shown in the UI. Mutable; clear it by dropping the prop, never by passing `''`. */
  alias?: string;
  /** VLAN id or VXLAN VNI, depending on the zone's type. Mutable. Absent means untagged. */
  tag?: number;
  /** Let guests on this bridge carry their own VLAN tags. Mutable. */
  vlanaware?: boolean;
  /**
   * Stop guests on this bridge from reaching each other directly. Mutable.
   * ⚠️ The wire name is `isolate-ports`, with a hyphen — see the ⚠️ on `shape` for why that costs
   *   attention in two places rather than one.
   */
  isolatePorts?: boolean;
}

export interface SdnVnetAttributes {
  vnet: string;
  /**
   * The same string as `vnet`, duplicated on purpose: it is the name a guest's `net0` must carry.
   * Referencing it from a `Proxmox.Lxc`'s props is what makes Alchemy build the network before the
   * container. A hardcoded `vmbr1` in `net0` is a string nothing checks and nothing orders.
   */
  bridge: string;
  zone: string;
  alias: string;
  /**
   * Absent when the vnet is untagged — see `tagOf` for why this is optional and not `0`.
   * ⚠️ `| undefined` IS LOAD-BEARING under exactOptionalPropertyTypes: the attributes
   *   builder always sets this key, writing `undefined` for an untagged vnet, so the type
   *   must permit a present-but-undefined value as well as an absent one. Without it the
   *   read path does not typecheck, and 0 is a real VLAN id so it cannot be the sentinel.
   */
  tag?: number | undefined;
  vlanaware: boolean;
  isolatePorts: boolean;
}

export interface ProxmoxSdnVnet extends Resource<
  'Proxmox.SdnVnet',
  SdnVnetProps,
  SdnVnetAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxSdnVnet = Resource<ProxmoxSdnVnet>('Proxmox.SdnVnet');

/**
 * ⚠️ AN ABSENT TAG IS `undefined`, NOT 0, which is why `SdnVnetAttributes.tag` is optional rather
 *   than falling back the way `memory` does in lxc.ts. VLAN id 0 and VXLAN VNI 0 are real values,
 *   so a 0 fallback would report an untagged vnet as tagged 0 and then diff forever against a
 *   declaration that asks for no tag at all.
 */
const tagOf = (value: unknown) => (typeof value === 'number' ? value : undefined);

/**
 * The fields PVE accepts on create and on update alike.
 *
 * ⚠️ THE WIRE NAME IS `isolate-ports`, WITH A HYPHEN; the prop is `isolatePorts` so no call site
 *   has to quote it. Both halves of that mapping have to be right: the form key here AND the read
 *   in `attributes`. `live['isolatePorts']` would be `undefined` forever, which reads as "the
 *   cluster does not have it set" and makes every plan ask for the same update, for good.
 */
const shape = (props: SdnVnetProps): Record<string, string> => {
  const alias = props.alias ?? '';
  return {
    // ⚠️ THE TWO BOOLEANS ARE ALWAYS SENT, `0` INCLUDED, AND THAT IS NOT AN OVERSIGHT. `0` and
    //   "never declared" mean the same thing to PVE and to `matches` below, so an explicit `0`
    //   makes the two converge — which is why neither ever appears in the `delete` list.
    'isolate-ports': props.isolatePorts === true ? '1' : '0',
    vlanaware: props.vlanaware === true ? '1' : '0',
    zone: props.zone,
    // ⚠️ AN EMPTY ALIAS IS OMITTED, NOT SENT AS `''`. `''` is how this file spells "unset", and
    //   unset goes through the `delete` parameter below; sending it as a value would ask PVE to
    //   store an empty description, which is a different request from having none.
    ...(alias === '' ? {} : { alias }),
    ...(props.tag === undefined ? {} : { tag: String(props.tag) }),
  };
};

/**
 * ⛔ OMITTING A FIELD DOES NOT CLEAR IT. PVE keeps whatever the config already holds, so a
 *   declaration that DROPS its alias would diff as `update` forever: `matches` compares `''`
 *   against the live text, the PUT says nothing about alias, and the next plan asks for the very
 *   same update. PVE's own answer is the `delete` parameter — a comma-separated list of properties
 *   to unset — which exists on the update endpoint only. That is why create does not come through
 *   here and calls `shape` directly.
 *
 * ⚠️ REASONED FROM PVE'S UPDATE SCHEMA, NOT MEASURED ON A CLUSTER — unlike the two MEASURED facts
 *   at the top of this file, and the difference is worth a reader's attention. `delete` is what
 *   `SectionConfig::updateSchema` adds to every PVE update endpoint, and unsetting a property that
 *   was never set is a no-op there. If THIS endpoint turns out to disagree, the blast radius is
 *   wider than the feature: a plain `{ vnet, zone }` vnet has neither alias nor tag, so its very
 *   first update carries `delete=alias,tag` and every update fails, not just an unset. The symptom
 *   is a 400 "parameter verification failed" naming `delete`; the fix is to drop this list and
 *   accept the forever-update on unset instead. Verify it once against a live vnet.
 */
const updateForm = (props: SdnVnetProps): Record<string, string> => {
  const unset = [
    ...((props.alias ?? '') === '' ? ['alias'] : []),
    ...(props.tag === undefined ? ['tag'] : []),
  ];
  return withClears(shape(props), unset);
};

const handlers = pveHandlers<SdnVnetProps, SdnVnetAttributes>({
  // ⛔ PVE gates this family's ITEM read on the allocate privilege, not the audit one — see
  //   `readRole` in resource.ts. The auditor-shaped lease reads 403, which `read` turns into
  //   "absent", and the plan then says create for an object that is plainly there.
  readRole: 'provision',
  attributes: (live, props) => ({
    alias: typeof live['alias'] === 'string' ? live['alias'] : '',
    bridge: props.vnet,
    isolatePorts: bool(live['isolate-ports']),
    tag: tagOf(live['tag']),
    vlanaware: bool(live['vlanaware']),
    vnet: props.vnet,
    /**
     * ⚠️ `''` RATHER THAN `props.zone` WHEN PVE DOES NOT SAY. Echoing the declared zone back would
     *   make an unreadable zone look like agreement; `''` matches no declared zone, so the plan
     *   reports drift instead. A vnet in the wrong zone is attached to the wrong network, and this
     *   is the one field here where a spurious update costs less than a missed one.
     */
    zone: typeof live['zone'] === 'string' ? live['zone'] : '',
  }),
  collection: () => 'cluster/sdn/vnets',
  createForm: (props) => ({ ...shape(props), vnet: props.vnet }),
  /**
   * ⚠️ `vnet`, `bridge` AND WHETHER THE CONFIG IS APPLIED ARE ABSENT FROM THIS COMPARISON ON
   *   PURPOSE. The first two are the path — a changed id is a different object, not an edit — and
   *   staged-vs-running is a fact about the cluster rather than about the declaration. Diffing it
   *   would report an update on every plan until somebody ran the apply, and then report another
   *   one the moment anybody else staged anything at all.
   */
  matches: (attributes, props) =>
    attributes.zone === props.zone &&
    attributes.alias === (props.alias ?? '') &&
    attributes.tag === props.tag &&
    attributes.vlanaware === (props.vlanaware === true) &&
    attributes.isolatePorts === (props.isolatePorts === true),
  /**
   * ⚠️ NO QUERY STRING HERE, HOWEVER TEMPTING. `?pending=1` would surface whether the staged
   *   config has been applied, but the factory uses this one path for GET, PUT and DELETE alike,
   *   and PVE answers an unexpected parameter on a write with "parameter verification failed".
   *   That is why staged-ness is documented at the top of this file rather than made an attribute.
   */
  path: (props) => `cluster/sdn/vnets/${props.vnet}`,
  updateForm,
});

/**
* ⛔ EMPTY, LIKE EVERY OTHER RESOURCE IN THIS PACKAGE. `GET /cluster/sdn/vnets` answers
*   with every vnet on the cluster, and on an estate already running SDN those are
*   load-bearing bridges with guests on them. Returning them would invite Alchemy to
*   adopt — and therefore one day delete — a network nobody declared here. Adoption is an
*   explicit act.
 
 *
* ⛔ A DELETE IS STAGED LIKE EVERY OTHER SDN WRITE. The vnet leaves `vnets.cfg` at once and
*   the bridge stays up on every node until `PUT /cluster/sdn` applies the removal, so a
*   plan reporting "1 deleted" has taken nothing off the network yet. Nothing here applies
*   on the operator's behalf: see the ⛔ at the top of this file.
 
 */
export const ProxmoxSdnVnetProvider = () =>
  Provider.effect(ProxmoxSdnVnet, Effect.succeed(ProxmoxSdnVnet.Provider.of(handlers)));

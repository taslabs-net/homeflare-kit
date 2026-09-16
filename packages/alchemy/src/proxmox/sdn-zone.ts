/**
 * `Proxmox.SdnZone` — the network a declared guest sits on, finally declared too.
 *
 * ★ WHY THIS ONE MATTERS MORE THAN IT LOOKS. Every guest NIC here names a bridge —
 *   `net0=name=eth0,bridge=vmbr0` — that nothing in this package declares: a hand-built interface,
 *   repeated per node, that a container silently depends on. A zone is the first piece of that
 *   dependency PVE will let a plan own.
 *
 * ⛔ SDN WRITES ARE STAGED, NOT APPLIED, AND THAT DEFEATS THE FACTORY'S READ-BACK GUARANTEE.
 *   POST and PUT under `cluster/sdn/zones` edit `/etc/pve/sdn/zones.cfg` and change NOTHING on any
 *   node. The plain GET reads that same staged file back, so `pveOperations` sees its own write,
 *   finds the object present, and reports a success in which no node gained an interface. The
 *   applied state is a different document — `.running-config` beside it — and `?pending=1` is the
 *   read that tells them apart: it returns a merged view with a `state` of new/changed/deleted.
 *
 * ⛔ THE APPLY CANNOT LIVE IN THIS RECONCILE, so it is absent rather than forgotten.
 *   `PUT /cluster/sdn` is the atomic pending-to-apply and it applies the WHOLE staged config —
 *   every zone, vnet and subnet, on every node. Called from a per-resource reconcile it would push
 *   some OTHER resource's half-written zone out to the cluster at whatever point the plan ordering
 *   reached this one, and PVE has no pre-apply hook to veto that. The apply belongs to ONE object
 *   that depends on all of them — a sibling `Proxmox.SdnApply` over `cluster/sdn`, or a stack-level
 *   hook that runs last — so that "declared" and "live on the nodes" stay two visible steps.
 *
 * ⚠️ SO THESE ATTRIBUTES DESCRIBE THE STAGED ZONE, and there is deliberately no `applied` flag:
 *   the factory uses ONE path for GET, PUT and DELETE, and PVE's parameter schemas are closed, so
 *   an unexpected `pending` on the PUT is a 400 rather than an ignored hint. Reading `?pending=1`
 *   means re-implementing the operations this file exists to share, and an `applied: true` that
 *   was never measured is worse than an absent one. Deploying this resource does not change the
 *   network; it changes what the next apply will do.
 *
 * ⛔ THE READ THIS RESOURCE PERFORMS NEEDS SDN.Allocate, NOT SDN.Audit, AND AN EARLIER DRAFT OF
 *   THIS COMMENT SAID OTHERWISE. Read off the cluster's own schema on 2026-09-13:
 *
 *     GET /cluster/sdn/zones          -> "list entries where you have SDN.Audit or SDN.Allocate"
 *     GET /cluster/sdn/zones/{zone}   -> {"check": ["perm", "/sdn/zones/{zone}", ["SDN.Allocate"]]}
 *
 *   `pveOperations.read` calls the ITEM endpoint, so an auditor-shaped `read` lease is REFUSED —
 *   and the refusal does not surface as a 403. `read` folds every failure into `undefined`, which
 *   the factory reads as "absent", so the plan says create, the POST goes out, and PVE answers
 *   that the zone already exists. This is the same class as Proxmox.Storage; see
 *   docs/privileges.md, "The failure that does not look like a permission problem".
 *
 * ⚠️ THE REST OF THE PRIVILEGES. Writes need SDN.Allocate (`/sdn/zones` to create,
 *   `/sdn/zones/{zone}` to update or delete); the apply — `Proxmox.SdnApply`, which is what
 *   actually publishes any of this — needs SDN.Allocate on `/sdn` itself. SDN.Use is NOT among
 *   them: it permits attaching a guest to an existing vnet and nothing else.
 */
import { Resource } from 'alchemy';
import * as Provider from 'alchemy/Provider';
import * as Effect from 'effect/Effect';
import { type PveRequirements, type WithTarget, pveHandlers } from './resource.ts';
import { csv, int, text, withClears } from './values.ts';

/** PVE's zone plugins. Which one a zone is decides which fields below it will even accept. */
export type SdnZoneType = 'evpn' | 'qinq' | 'simple' | 'vlan' | 'vxlan';

export interface SdnZoneProps extends WithTarget {
  /**
   * PVE's primary key. ⚠️ AT MOST EIGHT LOWERCASE ALPHANUMERICS, first one a letter: the id lands
   *   in generated interface names, so PVE enforces it with a regex whose rejection reads as
   *   "value does not match the regex pattern" rather than as "your name is too long".
   */
  zone: string;
  /**
   * ⛔ CREATE-TIME ONLY. `PUT /cluster/sdn/zones/{zone}` has no `type` parameter at all — a
   *   section's type is fixed when it is written. Changing it here is not an update PVE can
   *   perform; the ⛔ in `attributes` turns that edit into a refusal instead of a silent no-op.
   */
  type: SdnZoneType;
  /** Accepted by every zone type. Unset means the zone inherits the underlying bridge's MTU. */
  mtu?: number;
  /** ⚠️ WHICH NODES THE ZONE IS DEPLOYED TO. Unset means EVERY node, not none. */
  nodes?: string[];
  /** IPAM plugin id. Unset is the built-in `pve` one — the two are one zone, see `sameIpam`. */
  ipam?: string;
  /** DNS plugin id used to register guest records. */
  dns?: string;
  /** The domain those records are registered under, e.g. `example.internal`. */
  dnszone?: string;
  /** vxlan only, and REQUIRED there: the peer addresses the tunnel mesh is built from. */
  peers?: string[];
  /** evpn only, and required there. PVE's own hyphenated name, so no mapping to get wrong. */
  'vrf-vxlan'?: number;
  /** qinq only, and required there: the service VLAN tag the zone's vnets are stacked inside. */
  tag?: number;
  /** vlan and qinq only, and required in both: the existing bridge the zone is carved out of. */
  bridge?: string;
}

/**
 * ⛔ NO `digest` HERE, ON PURPOSE. PVE returns one, but it is the digest of the WHOLE zones.cfg
 *   file rather than of this section — declaring a SECOND zone would rewrite this one's stored
 *   attributes, and comparing it would report an update on a zone nobody touched.
 */
export interface SdnZoneAttributes {
  zone: string;
  type: SdnZoneType;
  /** 0 when unset, which is PVE's "inherit from the bridge" rather than an MTU of zero. */
  mtu: number;
  /** Normalised: split, sorted, rejoined. Never compare a raw PVE string to it — see `csv`. */
  nodes: string;
  /** The EFFECTIVE ipam: an absent one is reported as `pve`, because that is what will be used. */
  ipam: string;
  dns: string;
  dnszone: string;
  peers: string;
  'vrf-vxlan': number;
  tag: number;
  bridge: string;
  /** ⚠️ THE REMINDER IN THE STATE ITSELF: staged config. No value here says a node has the zone. */
  readonly staged: true;
}

export interface ProxmoxSdnZone extends Resource<
  'Proxmox.SdnZone',
  SdnZoneProps,
  SdnZoneAttributes,
  never,
  PveRequirements
> {}

export const ProxmoxSdnZone = Resource<ProxmoxSdnZone>('Proxmox.SdnZone');

/**
 * ⚠️ AN ABSENT `ipam` AND `ipam pve` ARE THE SAME ZONE. `pve` is the built-in default, and whether
 *   PVE materialises that word into zones.cfg on create is version-dependent — so comparing the
 *   raw values reports an update on the plan immediately AFTER the create, on a zone this provider
 *   just wrote itself. Normalising both sides is loop-proof under either behaviour.
 */
const sameIpam = (live: string, declared: string | undefined) =>
  (live === '' ? 'pve' : live) === (declared === undefined || declared === '' ? 'pve' : declared);

/**
 * The mutable fields, spread in only when defined.
 *
 * ⚠️ AN EMPTY STRING IS NOT "UNSET" FOR AN INTEGER FIELD. `mtu=` fails PVE's parameter check
 *   outright instead of clearing the value, so the pool.ts habit of sending `''` for an absent
 *   optional does not carry over here. Clearing is a separate verb — see `clearable`.
 */
const body = (props: SdnZoneProps): Record<string, string> => ({
  ...(props.bridge === undefined ? {} : { bridge: props.bridge }),
  ...(props.dns === undefined ? {} : { dns: props.dns }),
  ...(props.dnszone === undefined ? {} : { dnszone: props.dnszone }),
  ...(props.ipam === undefined ? {} : { ipam: props.ipam }),
  ...(props.mtu === undefined ? {} : { mtu: String(props.mtu) }),
  ...(props.nodes === undefined ? {} : { nodes: csv(props.nodes) }),
  ...(props.peers === undefined ? {} : { peers: csv(props.peers) }),
  ...(props.tag === undefined ? {} : { tag: String(props.tag) }),
  ...(props['vrf-vxlan'] === undefined ? {} : { 'vrf-vxlan': String(props['vrf-vxlan']) }),
});

/**
 * Which managed fields PVE will let `delete=` clear, per zone type.
 *
 * ⛔ A PUT THAT SIMPLY OMITS A FIELD DOES NOT CLEAR IT. PVE merges the form into the existing
 *   section, so dropping `mtu` from a declaration leaves the old MTU in place and `matches`
 *   reports an update on every plan forever — the exact bug this table exists to prevent.
 * ⛔ AND THE LIST CANNOT BE THE SAME FOR EVERY TYPE. `delete=<opt>` dies with "no such option"
 *   when the option is not in that plugin's schema (`peers` on a simple zone) and with "unable to
 *   delete required option" when it is required there. `bridge`, `tag`, `peers` and `vrf-vxlan`
 *   are required by the only types that accept them, so none of the four is ever clearable: a
 *   zone that lost one is a replace, not an update.
 * ⚠️ `ipam` IS OMITTED FOR evpn DELIBERATELY. It is optional on the other four; on evpn its
 *   optionality has moved between releases, and a wrong entry here is a hard 400 on EVERY update
 *   rather than a cosmetic diff. Dropping `ipam` from an evpn declaration therefore reports an
 *   update that does not converge — visible, unlike a wrong delete that breaks the zone.
 */
const clearable: Record<SdnZoneType, readonly string[]> = {
  evpn: ['dns', 'dnszone', 'mtu', 'nodes'],
  qinq: ['dns', 'dnszone', 'ipam', 'mtu', 'nodes'],
  simple: ['dns', 'dnszone', 'ipam', 'mtu', 'nodes'],
  vlan: ['dns', 'dnszone', 'ipam', 'mtu', 'nodes'],
  vxlan: ['dns', 'dnszone', 'ipam', 'mtu', 'nodes'],
};

const handlers = pveHandlers<SdnZoneProps, SdnZoneAttributes>({
  // ⛔ PVE gates this family's ITEM read on the allocate privilege, not the audit one — see
  //   `readRole` in resource.ts. The auditor-shaped lease reads 403, which `read` turns into
  //   "absent", and the plan then says create for an object that is plainly there.
  readRole: 'provision',
  attributes: (live, props) => {
    /**
     * ⛔ A ZONE OF ANOTHER TYPE IS ANOTHER OBJECT, AND "ABSENT" IS THE HONEST ANSWER. A PUT cannot
     *   change `type`, and the factory only calls a change `replace` for a resource with no update
     *   path — which this is not. Reporting the foreign zone as missing makes reconcile POST, and
     *   PVE refuses with "sdn zone ID 'x' already defined": a loud, accurate error instead of a
     *   silent noop over somebody else's zone. An older PVE that omits `type` falls through.
     */
    const liveType = text(live['type']);
    if (liveType !== '' && liveType !== props.type) return undefined;
    return {
      bridge: text(live['bridge']),
      dns: text(live['dns']),
      dnszone: text(live['dnszone']),
      ipam: text(live['ipam']) === '' ? 'pve' : text(live['ipam']),
      mtu: int(live['mtu'], 0),
      nodes: csv(text(live['nodes'])),
      peers: csv(text(live['peers'])),
      staged: true,
      tag: int(live['tag'], 0),
      type: props.type,
      'vrf-vxlan': int(live['vrf-vxlan'], 0),
      zone: props.zone,
    };
  },
  collection: () => 'cluster/sdn/zones',
  createForm: (props) => ({ ...body(props), type: props.type, zone: props.zone }),
  /**
   * ⚠️ `type` AND `zone` ARE NOT COMPARED. `zone` is the key the object was read by, and `type` is
   *   handled above by refusing to recognise a zone of the wrong one. Comparing either here would
   *   produce a diff whose update can never satisfy it.
   */
  matches: (attributes, props) =>
    attributes.mtu === (props.mtu ?? 0) &&
    attributes.nodes === csv(props.nodes) &&
    sameIpam(attributes.ipam, props.ipam) &&
    attributes.dns === (props.dns ?? '') &&
    attributes.dnszone === (props.dnszone ?? '') &&
    attributes.peers === csv(props.peers) &&
    attributes['vrf-vxlan'] === (props['vrf-vxlan'] ?? 0) &&
    attributes.tag === (props.tag ?? 0) &&
    attributes.bridge === (props.bridge ?? ''),
  path: (props) => `cluster/sdn/zones/${props.zone}`,
  updateForm: (props) => {
    const fields = body(props);
    const clear = clearable[props.type].filter((option) => fields[option] === undefined);
    return withClears(fields, clear);
  },
});

/**
* ⛔ Empty for the same reason as every other resource here, and with extra force for SDN:
*   `GET /cluster/sdn/zones` answers with the zones the cluster's whole network already
*   runs on. Adopting those would make a later `alchemy destroy` a cluster-wide outage.
 
 *
* ⛔ A DELETE IS STAGED TOO, AND THAT IS THE HALF PEOPLE FORGET. The section leaves
*   zones.cfg and Alchemy drops the resource, but the zone KEEPS RUNNING on every node
*   until something applies `PUT /cluster/sdn`: a destroy nobody applies reads as complete
*   in the plan and has not happened on the cluster.
* ⚠️ PVE also refuses to remove a zone that still holds vnets. That refusal is kept — it is
*   the cluster declining to orphan a network because a line left a file.
 
 */
export const ProxmoxSdnZoneProvider = () =>
  Provider.effect(ProxmoxSdnZone, Effect.succeed(ProxmoxSdnZone.Provider.of(handlers)));

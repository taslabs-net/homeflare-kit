# Talos networking — VLAN-aware bridges, Cilium BGP, and what must be measured

Status: active — decision record for the Talos VM network path; retire when
the first Talos VMs are deployed on the settled answer
Verified: 2026-09-26 (red-team findings applied same date)

Part of the design suite gating Talos-on-PVE work. Companions:
[secrets flow](./2026-09-26-talos-secrets-flow.md) ·
[stack + first boot](./2026-09-26-talos-stack-first-boot.md) ·
[Ceph transport](./2026-09-26-ceph-mon-transport.md).
⛔ This repo is public: no hostnames, addresses, VLAN ids, subnets or secret
values appear here — the concrete numbers land in the private estate checkout.

## Default (coordinator recommendation until Tim says otherwise)

**VLAN-aware vmbr bridges + Cilium BGP inside k8s, peering to the
UniFi/OPNsense routers.** VM NICs attach to an existing bridge with a dedicated
VLAN tag; PVE SDN stays measured-none, so no SDN apply ever runs — an apply
reloads networking on every node and the Ceph fabric rides on it
(homeflare-proxmox `docs/sdn.md`). Service VIPs are advertised by Cilium BGP
via Helm + CRDs — the dogfood decision record
([PR 253](https://github.com/taslabs-net/homeflare-kit/pull/253), open as of
2026-09-26; `packages/alchemy/docs/talos-argocd-dogfood.md` once merged)
already fixes Cilium as Helm+CRDs, no invented SDK, and carries the
ASN/peer/VIP placeholder variables.

## Measure before the first VM row (coordinator, read-only)

The draft checked one flag; the red team found four gaps. All of these are
reads, none is a Talos-stack row, and every one gates the first VM deploy:

1. **`bridge-vlan-aware` on the target bridge of the three TB4 nodes.** The
   flag sits in the not-yet-adopted NodeNetwork rows and has not been
   measured. If it is off, enabling it is a node-network change that goes
   through the NodeNetwork lane, not this stack.
2. **Ceph public network reachability from the Talos VLAN.** The mons sit on
   their own subnet (homeflare-proxmox `docs/ceph.md`, mon inventory), so
   ceph-csi pods reaching the mons and OSDs is a routed path — likely through
   the firewall. Measure the route and the firewall policy; do not assume L2
   adjacency. ⚠️ Without this read, the Ceph transport companion's ceph-csi
   consumer is designed against an unreachable cluster.
3. **The physical path for the VLAN**: the switch trunk toward each PVE
   node's uplink carries the tag, and the router holds the VLAN interface
   (gateway, DHCP or static plan for the node IPs). Neither is declared in
   any stack today — see "Router side" below.
4. **BGP capability of the chosen peer(s), on the actual models.** UniFi BGP
   is an uploaded FRR config available on specific gateways only (REASONED —
   verify against the installed controller/gateway before relying on it);
   OPNsense needs the `os-frr` plugin installed and enabled. Confirm before
   Cilium's peers are configured, not after.

## Router side is declared in no stack

The Cilium side of the BGP session is declared (Helm values + CRDs, dogfood
record). The router side — FRR config on UniFi, os-frr on OPNsense, the VLAN
interface itself — has no owning stack or lane today. Until one exists it is
an **operator step recorded in the private estate checkout** (config, date,
device). ⚠️ An undocumented router change is how this design rots.

## Peering — one gateway first

⚠️ Answering "both" to D-N2 makes each VIP reachable via two next-hops, and
return traffic can exit through the other gateway — asymmetric routes through
a stateful firewall drop the session. Recommended: **start with the single
gateway that owns the Talos VLAN interface**; add the second peer only with a
design for symmetric return paths (or firewall state exemptions for the VIP
ranges).

## Alternative (SDN VNets), and what changes

The SDN chain lands on the Talos path — SdnApply rebuilt with a
member-node-changes refusal, fabric families declared first, every apply a
cluster-wide network reload; the VLAN reads above are replaced by VNet creates
through the first-create gate; Cilium's BGP peers move to SDN fabric
addresses. The secrets flow and O1 are unchanged either way. Not recommended:
Tim's SdnApply answer (observed, never declared) already points the other way.

## Tim must decide

- **D-N1** VLAN id + subnet for the Talos VLAN (recorded privately; this doc
  stays number-free).
- **D-N2** BGP peer: UniFi, OPNsense, or both — recommended: the one gateway
  that owns the Talos VLAN interface, per the asymmetry note above.
- **D-N3** Who owns the router-side config for now: operator step recorded in
  the estate checkout (recommended), or wait for a future UniFi/OPNsense lane
  before any BGP peering.

## Acceptance

1. Coordinator reads 1–4 above recorded (command + date) in the private
   estate checkout **before** the first VM deploy; read 2 confirms a routed
   path from the Talos VLAN to the Ceph public network.
2. The router-side BGP/VLAN config is recorded per D-N3 before Cilium's BGP
   CRDs reference the peer.
3. With D-N2's single peer: the BGP session establishes and a test VIP is
   reachable from the LAN; no second peer exists unless its symmetric-return
   design is recorded.

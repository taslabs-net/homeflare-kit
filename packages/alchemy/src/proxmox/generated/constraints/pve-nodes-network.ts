/**
 * Generated pve-manager parameter constraints for `/nodes/{node}/network` — DO NOT EDIT BY HAND.
 *
 * Run: bun codegen/constraints.ts
 * Manifest entry: `pve-apidoc` — pve-manager 9.2.11/f6997e698c7933ea
 *   sha256 9def8f13611184ee, read on a PVE cluster node from
 *   /usr/share/pve-docs/api-viewer/apidoc.js
 *
 * 58 of this product's 258 POST/PUT endpoints are tabled across all areas: the ones
 * this package writes to, named in its own source. Every other vendor write endpoint is UNTABLED
 * and therefore unchecked at plan time.
 *
 * ⚠️ A `patternSource` with no `pattern` beside it is a rule that could NOT be carried into a
 *   JavaScript RegExp faithfully (codegen/pattern.ts). It is recorded and NOT enforced.
 * ⚠️ `pattern` IS NOT THE VENDOR'S SPELLING. For PVE it is anchored, because PVE applies
 *   `m/^$pattern$/` itself (JSONSchema.pm); for PBS it is the vendor's own, which already
 *   carries its anchors. `patternSource` is the spelling to quote at a human — param-rules.ts.
 * ⚠️ `each: true` means the value rules describe every ELEMENT of a repeated key, because the
 *   parameter is an array and stated its limits on `items`.
 */
import type { EndpointConstraints } from '../../constraints.ts';

export const PVE_NODES_NETWORK_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /nodes/{node}/network": {
    "address": {"format":"ipv4","type":"string"},
    "address6": {"format":"ipv6","type":"string"},
    "bond-primary": {"format":"pve-iface","type":"string"},
    "bond_mode": {"enum":["balance-rr","active-backup","balance-xor","broadcast","802.3ad","balance-tlb","balance-alb","balance-slb","lacp-balance-slb","lacp-balance-tcp"],"type":"string"},
    "bond_xmit_hash_policy": {"enum":["layer2","layer2+3","layer3+4"],"type":"string"},
    "bridge_ports": {"format":"pve-iface-list","type":"string"},
    "bridge_vids": {"format":"pve-vlan-id-or-range-list","type":"string"},
    "cidr": {"format":"CIDRv4","type":"string"},
    "cidr6": {"format":"CIDRv6","type":"string"},
    "gateway": {"format":"ipv4","type":"string"},
    "gateway6": {"format":"ipv6","type":"string"},
    "iface": {"format":"pve-iface","maxLength":20,"minLength":2,"required":true,"type":"string"},
    "mtu": {"maximum":65520,"minimum":1280,"type":"integer"},
    "netmask": {"format":"ipv4mask","type":"string"},
    "netmask6": {"maximum":128,"minimum":0,"type":"integer"},
    "ovs_bonds": {"format":"pve-iface-list","type":"string"},
    "ovs_bridge": {"format":"pve-iface","type":"string"},
    "ovs_options": {"maxLength":1024,"type":"string"},
    "ovs_ports": {"format":"pve-iface-list","type":"string"},
    "ovs_tag": {"maximum":4094,"minimum":1,"type":"integer"},
    "slaves": {"format":"pve-iface-list","type":"string"},
    "type": {"enum":["bridge","bond","eth","alias","vlan","fabric","OVSBridge","OVSBond","OVSPort","OVSIntPort","vnet","unknown"],"required":true,"type":"string"},
    "vlan-id": {"maximum":4094,"minimum":1,"type":"integer"},
    "vlan-raw-device": {"format":"pve-iface","type":"string"},
  },
  "pve:PUT /nodes/{node}/network": {},
  "pve:PUT /nodes/{node}/network/{iface}": {
    "address": {"format":"ipv4","type":"string"},
    "address6": {"format":"ipv6","type":"string"},
    "bond-primary": {"format":"pve-iface","type":"string"},
    "bond_mode": {"enum":["balance-rr","active-backup","balance-xor","broadcast","802.3ad","balance-tlb","balance-alb","balance-slb","lacp-balance-slb","lacp-balance-tcp"],"type":"string"},
    "bond_xmit_hash_policy": {"enum":["layer2","layer2+3","layer3+4"],"type":"string"},
    "bridge_ports": {"format":"pve-iface-list","type":"string"},
    "bridge_vids": {"format":"pve-vlan-id-or-range-list","type":"string"},
    "cidr": {"format":"CIDRv4","type":"string"},
    "cidr6": {"format":"CIDRv6","type":"string"},
    "delete": {"format":"pve-configid-list","type":"string"},
    "gateway": {"format":"ipv4","type":"string"},
    "gateway6": {"format":"ipv6","type":"string"},
    "mtu": {"maximum":65520,"minimum":1280,"type":"integer"},
    "netmask": {"format":"ipv4mask","type":"string"},
    "netmask6": {"maximum":128,"minimum":0,"type":"integer"},
    "ovs_bonds": {"format":"pve-iface-list","type":"string"},
    "ovs_bridge": {"format":"pve-iface","type":"string"},
    "ovs_options": {"maxLength":1024,"type":"string"},
    "ovs_ports": {"format":"pve-iface-list","type":"string"},
    "ovs_tag": {"maximum":4094,"minimum":1,"type":"integer"},
    "slaves": {"format":"pve-iface-list","type":"string"},
    "type": {"enum":["bridge","bond","eth","alias","vlan","fabric","OVSBridge","OVSBond","OVSPort","OVSIntPort","vnet","unknown"],"required":true,"type":"string"},
    "vlan-id": {"maximum":4094,"minimum":1,"type":"integer"},
    "vlan-raw-device": {"format":"pve-iface","type":"string"},
  },
};

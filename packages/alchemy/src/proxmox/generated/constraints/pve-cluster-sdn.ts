/**
 * Generated pve-manager parameter constraints for `/cluster/sdn` — DO NOT EDIT BY HAND.
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

export const PVE_CLUSTER_SDN_CONSTRAINTS: Readonly<Record<string, EndpointConstraints>> = {
  "pve:POST /cluster/sdn/vnets": {
    "alias": {"maxLength":256,"patternSource":"(?^i:[\\(\\)-_.\\w\\d\\s]{0,256})","type":"string"},
    "tag": {"maximum":16777215,"minimum":1,"type":"integer"},
    "type": {"enum":["vnet"],"type":"string"},
    "vnet": {"maxLength":8,"minLength":2,"pattern":"^[a-zA-Z][a-zA-Z0-9]*[a-zA-Z0-9]\\n?$","patternSource":"[a-zA-Z][a-zA-Z0-9]*[a-zA-Z0-9]","required":true,"type":"string"},
    "zone": {"required":true,"type":"string"},
  },
  "pve:POST /cluster/sdn/vnets/{vnet}/subnets": {
    "dhcp-dns-server": {"format":"ip","type":"string"},
    "dhcp-range": {"each":true,"format":"pve-sdn-dhcp-range","type":"array"},
    "dnszoneprefix": {"format":"dns-name","type":"string"},
    "gateway": {"format":"ip","type":"string"},
    "subnet": {"format":"pve-sdn-subnet-id","required":true,"type":"string"},
    "type": {"enum":["subnet"],"required":true,"type":"string"},
  },
  "pve:POST /cluster/sdn/zones": {
    "dhcp": {"enum":["dnsmasq"],"type":"string"},
    "dnszone": {"format":"dns-name","type":"string"},
    "exitnodes": {"format":"pve-node-list","type":"string"},
    "exitnodes-primary": {"format":"pve-node","type":"string"},
    "fabric": {"format":"pve-sdn-fabric-id","type":"string"},
    "mac": {"format":"mac-addr","type":"string"},
    "nodes": {"format":"pve-node-list","type":"string"},
    "peers": {"format":"ip-list","type":"string"},
    "rt-import": {"format":"pve-sdn-bgp-rt-list","type":"string"},
    "secondary-controllers": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[a-zA-Z][a-zA-Z0-9_-]*[a-zA-Z0-9]\\n?$","patternSource":"[a-zA-Z][a-zA-Z0-9_-]*[a-zA-Z0-9]","type":"array"},
    "tag": {"minimum":0,"type":"integer"},
    "type": {"enum":["evpn","faucet","qinq","simple","vlan","vxlan"],"format":"pve-configid","required":true,"type":"string"},
    "vlan-protocol": {"default":"802.1q","enum":["802.1q","802.1ad"],"type":"string"},
    "vrf-vxlan": {"maximum":16777215,"minimum":1,"type":"integer"},
    "vxlan-port": {"default":"4789","maximum":65536,"minimum":1,"type":"integer"},
    "zone": {"maxLength":8,"minLength":2,"pattern":"^[a-zA-Z][a-zA-Z0-9]*[a-zA-Z0-9]\\n?$","patternSource":"[a-zA-Z][a-zA-Z0-9]*[a-zA-Z0-9]","required":true,"type":"string"},
  },
  "pve:PUT /cluster/sdn": {},
  "pve:PUT /cluster/sdn/vnets/{vnet}": {
    "alias": {"maxLength":256,"patternSource":"(?^i:[\\(\\)-_.\\w\\d\\s]{0,256})","type":"string"},
    "delete": {"format":"pve-configid-list","maxLength":4096,"type":"string"},
    "digest": {"maxLength":64,"type":"string"},
    "tag": {"maximum":16777215,"minimum":1,"type":"integer"},
  },
  "pve:PUT /cluster/sdn/vnets/{vnet}/subnets/{subnet}": {
    "delete": {"format":"pve-configid-list","maxLength":4096,"type":"string"},
    "dhcp-dns-server": {"format":"ip","type":"string"},
    "dhcp-range": {"each":true,"format":"pve-sdn-dhcp-range","type":"array"},
    "digest": {"maxLength":64,"type":"string"},
    "dnszoneprefix": {"format":"dns-name","type":"string"},
    "gateway": {"format":"ip","type":"string"},
  },
  "pve:PUT /cluster/sdn/zones/{zone}": {
    "delete": {"format":"pve-configid-list","maxLength":4096,"type":"string"},
    "dhcp": {"enum":["dnsmasq"],"type":"string"},
    "digest": {"maxLength":64,"type":"string"},
    "dnszone": {"format":"dns-name","type":"string"},
    "exitnodes": {"format":"pve-node-list","type":"string"},
    "exitnodes-primary": {"format":"pve-node","type":"string"},
    "fabric": {"format":"pve-sdn-fabric-id","type":"string"},
    "mac": {"format":"mac-addr","type":"string"},
    "nodes": {"format":"pve-node-list","type":"string"},
    "peers": {"format":"ip-list","type":"string"},
    "rt-import": {"format":"pve-sdn-bgp-rt-list","type":"string"},
    "secondary-controllers": {"each":true,"maxLength":64,"minLength":2,"pattern":"^[a-zA-Z][a-zA-Z0-9_-]*[a-zA-Z0-9]\\n?$","patternSource":"[a-zA-Z][a-zA-Z0-9_-]*[a-zA-Z0-9]","type":"array"},
    "tag": {"minimum":0,"type":"integer"},
    "vlan-protocol": {"default":"802.1q","enum":["802.1q","802.1ad"],"type":"string"},
    "vrf-vxlan": {"maximum":16777215,"minimum":1,"type":"integer"},
    "vxlan-port": {"default":"4789","maximum":65536,"minimum":1,"type":"integer"},
  },
};

/**
 * IANA special-purpose address ranges — DO NOT EDIT BY HAND.
 *
 * Run: bun packages/typesafe/scripts/gen-gate-tables.ts
 *
 * Source: https://www.iana.org/assignments/iana-ipv4-special-registry/iana-ipv4-special-registry-1.csv
 *   sha256 e3e39e76d00b1677335db8e9a805c7b9480ea2f4dc9e33f0b93cd3a905128d73, 2423 bytes, fetched 2026-09-23T00:00:00Z, public domain (IANA registry)
 * Source: https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry-1.csv
 *   sha256 775feea0621dec8735a44fbf30f762e721e8f0a1b3ab7eb341961a88cfce2139, 2289 bytes, fetched 2026-09-23T00:00:00Z, public domain (IANA registry)
 * refuseByDefault covers Private-Use, Shared Address Space, Unique-Local and the two
 * link-local rows — a REVIEWED CONSTANT (gen-gate-tables-ranges.ts), not vendor data.
 * Loopback and every Documentation range are recorded (category) but refuse only when
 * the caller opts in via gate options.
 */
export interface SpecialRange {
  readonly cidr: string;
  readonly name: string;
  readonly family: 4 | 6;
  readonly refuseByDefault: boolean;
  readonly category: 'default-refuse' | 'loopback' | 'documentation' | 'recorded-only';
}

export const SPECIAL_RANGES: readonly SpecialRange[] = [
  { cidr: "0.0.0.0/8", name: "\"This network\"", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "0.0.0.0/32", name: "\"This host on this network\"", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "10.0.0.0/8", name: "Private-Use", family: 4, refuseByDefault: true, category: "default-refuse" },
  { cidr: "100.64.0.0/10", name: "Shared Address Space", family: 4, refuseByDefault: true, category: "default-refuse" },
  { cidr: "127.0.0.0/8", name: "Loopback", family: 4, refuseByDefault: false, category: "loopback" },
  { cidr: "169.254.0.0/16", name: "Link Local", family: 4, refuseByDefault: true, category: "default-refuse" },
  { cidr: "172.16.0.0/12", name: "Private-Use", family: 4, refuseByDefault: true, category: "default-refuse" },
  { cidr: "192.0.0.0/24", name: "IETF Protocol Assignments", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.0.0.0/29", name: "IPv4 Service Continuity Prefix", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.0.0.8/32", name: "IPv4 dummy address", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.0.0.9/32", name: "Port Control Protocol Anycast", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.0.0.10/32", name: "Traversal Using Relays around NAT Anycast", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.0.0.170/32", name: "NAT64/DNS64 Discovery", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.0.2.0/24", name: "Documentation (TEST-NET-1)", family: 4, refuseByDefault: false, category: "documentation" },
  { cidr: "192.31.196.0/24", name: "AS112-v4", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.52.193.0/24", name: "AMT", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.88.99.0/24", name: "Deprecated (6to4 Relay Anycast)", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.88.99.2/32", name: "6a44-relay anycast address", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "192.168.0.0/16", name: "Private-Use", family: 4, refuseByDefault: true, category: "default-refuse" },
  { cidr: "192.175.48.0/24", name: "Direct Delegation AS112 Service", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "198.18.0.0/15", name: "Benchmarking", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "198.51.100.0/24", name: "Documentation (TEST-NET-2)", family: 4, refuseByDefault: false, category: "documentation" },
  { cidr: "203.0.113.0/24", name: "Documentation (TEST-NET-3)", family: 4, refuseByDefault: false, category: "documentation" },
  { cidr: "240.0.0.0/4", name: "Reserved", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "255.255.255.255/32", name: "Limited Broadcast", family: 4, refuseByDefault: false, category: "recorded-only" },
  { cidr: "::1/128", name: "Loopback Address", family: 6, refuseByDefault: false, category: "loopback" },
  { cidr: "::/128", name: "Unspecified Address", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "::ffff:0:0/96", name: "IPv4-mapped Address", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "64:ff9b::/96", name: "IPv4-IPv6 Translat.", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "64:ff9b:1::/48", name: "IPv4-IPv6 Translat.", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "100::/64", name: "Discard-Only Address Block", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "100:0:0:1::/64", name: "Dummy IPv6 Prefix", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001::/23", name: "IETF Protocol Assignments", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001::/32", name: "TEREDO", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:1::1/128", name: "Port Control Protocol Anycast", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:1::2/128", name: "Traversal Using Relays around NAT Anycast", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:1::3/128", name: "DNS-SD Service Registration Protocol Anycast", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:2::/48", name: "Benchmarking", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:3::/32", name: "AMT", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:4:112::/48", name: "AS112-v6", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:10::/28", name: "Deprecated (previously ORCHID)", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:20::/28", name: "ORCHIDv2", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:30::/28", name: "Drone Remote ID Protocol Entity Tags (DETs) Prefix", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2001:db8::/32", name: "Documentation", family: 6, refuseByDefault: false, category: "documentation" },
  { cidr: "2002::/16", name: "6to4", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "2620:4f:8000::/48", name: "Direct Delegation AS112 Service", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "3fff::/20", name: "Documentation", family: 6, refuseByDefault: false, category: "documentation" },
  { cidr: "5f00::/16", name: "Segment Routing (SRv6) SIDs", family: 6, refuseByDefault: false, category: "recorded-only" },
  { cidr: "fc00::/7", name: "Unique-Local", family: 6, refuseByDefault: true, category: "default-refuse" },
  { cidr: "fe80::/10", name: "Link-Local Unicast", family: 6, refuseByDefault: true, category: "default-refuse" },
];

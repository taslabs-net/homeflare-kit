/**
 * How a subnet crosses the wire in both directions, and what PVE actually calls its path.
 *
 * ★ SPLIT OUT OF sdn-subnet.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, on the seam
 *   node-network-form.ts cuts rather than at a convenient line number: this file owns the
 *   COERCIONS in BOTH directions plus the derived id, because a read that normalises differently
 *   from the write that produced it is exactly how a forever-diff is born. sdn-subnet.ts answers
 *   "what is a subnet, and when has it changed". Nothing here calls the cluster.
 *
 * ⚠️ THE `import type` BACK TO sdn-subnet.ts IS A CYCLE ON PAPER ONLY — type-only, so it is erased
 *   before anything runs and `SdnSubnetProps` stays in the file that declares the resource.
 */
import type { SdnSubnetProps } from './sdn-subnet.ts';
import { propertyString, withClears } from './values.ts';

/** One DHCP pool. PVE's property-string keys are `start-address`/`end-address`; see `rangeString`. */
export type DhcpRange = { start: string; end: string };

/**
 * The id PVE files a subnet under — and therefore the path segment GET, PUT and DELETE address it
 * by, which is NOT the value POST is handed.
 *
 * ⛔ MEASURED from `/usr/share/perl5/PVE/API2/Network/SDN/Subnets.pm` on pve-manager 9.2.11, in
 *   the create handler: `my $id = $cidr =~ s/\//-/r; $id = "$zoneid-$id";`. So `subnet=10.0.0.0/24`
 *   goes out and `lab-10.0.0.0-24` is what exists afterwards. A CIDR cannot be a path segment
 *   anyway — it carries a slash — so there is no spelling of this endpoint that takes the CIDR.
 *
 * ⚠️ `.replace`, NOT `.replaceAll`, AND THE PARITY IS DELIBERATE. Perl's `s/\//-/r` has no `/g`, so
 *   it rewrites the FIRST slash only. A CIDR has exactly one, so the two agree on every legal
 *   input; they would stop agreeing on an illegal one, and agreeing with PVE is the point.
 */
export const subnetId = (props: Pick<SdnSubnetProps, 'cidr' | 'zone'>) =>
  `${props.zone}-${props.cidr.replace('/', '-')}`;

/** A range on its way OUT. PVE stores the string verbatim; nothing rewrites it. */
const rangeString = (range: DhcpRange) => `start-address=${range.start},end-address=${range.end}`;

/**
 * DHCP ranges, from either shape, as one comparable string.
 *
 * ⛔ THIS FAMILY'S WRITE SHAPE AND READ SHAPE ARE DIFFERENT, WHICH IS THE CLASSIC FOREVER-DIFF.
 *   MEASURED from the API module: `$scfg->{'dhcp-range'} = get_dhcp_ranges($scfg)` runs
 *   `parse_property_string` over every stored element, so a range WRITTEN as the string
 *   `start-address=10.0.0.10,end-address=10.0.0.20` is READ BACK as the object
 *   `{"start-address":"10.0.0.10","end-address":"10.0.0.20"}`. `propertyString` in values.ts
 *   flattens both shapes to one sorted form and exists for exactly this — see its own ⚠️.
 *
 * ⚠️ AND IT IS A LIST, SO ORDER MUST NOT BE MEANING. PVE validates only that ranges do not overlap
 *   and stores them in the order given; two declarations naming the same pools the other way round
 *   are the same subnet. Sorting is what stops that being an update, exactly as `csv` does for a
 *   zone's `nodes`.
 *
 * ⚠️ `;` IS THE JOINER BECAUSE `,` AND `=` ARE BOTH INSIDE THE VALUES. It never appears in an IPv4
 *   or IPv6 address or in a property-string key, so the joined form cannot be ambiguous.
 */
export const dhcpRanges = (value: unknown): string =>
  (Array.isArray(value) ? value : [])
    .map((entry: unknown) => propertyString(entry))
    .filter((entry) => entry !== '')
    .sort()
    .join(';');

/** The declared side of that same comparison, through the same funnel so it cannot drift. */
export const declaredRanges = (range: DhcpRange | undefined) =>
  range === undefined ? '' : dhcpRanges([rangeString(range)]);

/**
 * ⚠️ AN EMPTY STRING IS HOW A CALLER SPELLS "UNSET", AND IT MUST NOT REACH PVE. `gateway` and
 *   `dhcp-dns-server` are `format => 'ip'` and `dnszoneprefix` is `format => 'dns-name'`, so `''`
 *   is a parameter-verification 400 rather than a clear. Clearing is a separate verb — `delete=`.
 */
const unset = (value: string | undefined) =>
  value === undefined || value === '' ? undefined : value;

/**
 * Every optional this resource MANAGES: the value to send, or `undefined` meaning "clear it".
 *
 * ⛔ ONE TABLE FEEDS BOTH HALVES OF AN UPDATE, the way metric-server-form.ts does it, and for the
 *   same measured reason: A PUT THAT OMITS A FIELD DOES NOT CLEAR IT. PVE merges the form into the
 *   existing section (`$data->{$_} = $opts->{$_} for keys $opts->%*`), so dropping `gateway` from a
 *   declaration leaves the old gateway in place and `matches` asks for the same update forever.
 *   Deriving the form and the `delete=` list from one map makes "managed but not clearable"
 *   impossible to write here.
 *
 * ⛔ AND THE TWO HALVES MUST NOT OVERLAP. MEASURED in `PVE::SectionConfig::delete_from_config`
 *   (SectionConfig.pm:1853): naming a key in BOTH the form and `delete=` dies with "cannot set and
 *   delete property '<k>' at the same time!". Because both halves are read off this one map, an
 *   entry is in exactly one of them by construction.
 *
 * ⛔ NOTHING SET OUT OF BAND MAY BE LISTED HERE. A field in this map is CLEARED the moment it is
 *   undeclared, so a live subnet whose DHCP pool an operator widened in the UI is narrowed back on
 *   the next deploy. That is full ownership, the same bargain sdn-vnet.ts strikes over `alias`, and
 *   it is a bargain rather than an accident only while this list stays deliberate.
 *
 * ⚠️ `snat` IS ABSENT ON PURPOSE AND LIVES IN `body` INSTEAD. It is a boolean, and `0` and "never
 *   declared" are the same subnet to PVE and to `matches`, so sending an explicit `0` converges
 *   without a `delete=` — the same choice sdn-vnet.ts makes for `vlanaware` and `isolate-ports`.
 */
export const optional = (props: SdnSubnetProps): Record<string, string | undefined> => ({
  'dhcp-dns-server': unset(props.dhcpDnsServer),
  'dhcp-range': props.dhcpRange === undefined ? undefined : rangeString(props.dhcpRange),
  dnszoneprefix: unset(props.dnszoneprefix),
  gateway: unset(props.gateway),
});

/**
 * The fields sent on EVERY write, create and update alike.
 *
 * ⚠️ `vnet` IS SENT THOUGH THE URL ALREADY CARRIES IT. PVE's handler reads `$param->{vnet}` to
 *   resolve the zone for its permission check, and it is a declared parameter of both the create
 *   and the update schema, so sending the same value the path carries is accepted and removes this
 *   file's dependence on the router injecting a path placeholder into the parameter hash.
 */
export const body = (props: SdnSubnetProps): Record<string, string> => ({
  snat: props.snat === true ? '1' : '0',
  vnet: props.vnet,
  ...Object.fromEntries(
    Object.entries(optional(props)).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  ),
});

/**
 * ⚠️ `type` IS HARDCODED, NOT A PROP. PVE's create schema declares it as an enum with exactly one
 *   member, `subnet`, so a prop for it could only ever hold one value — and the POST refuses to
 *   proceed without it, which is the parameter-verification error sdn-vnet.ts records.
 */
export const createForm = (props: SdnSubnetProps): Record<string, string> => ({
  ...body(props),
  subnet: props.cidr,
  type: 'subnet',
});

/**
 * ★ CLEARING AN OPTION THAT WAS NEVER SET IS A SILENT NO-OP, AND THIS IS MEASURED RATHER THAN
 *   HOPED FOR. sdn-vnet.ts flags the same `delete=` habit as REASONED-not-measured and warns that a
 *   first update on a bare object would carry `delete=alias,tag`. Read off the code both endpoints
 *   share — `PVE::SectionConfig::delete_from_config`, SectionConfig.pm:1853-1866 — the loop dies
 *   only for an option that is unknown to the plugin, not optional, fixed, or also being set; for
 *   an option simply absent from the section it runs `delete $config->{$k}` on a missing key and
 *   moves on. All four keys above are `optional => 1` in `SubnetPlugin::options`, so a bare
 *   subnet's first update carries `delete=dhcp-dns-server,dhcp-range,dnszoneprefix,gateway` and
 *   PVE accepts it. `vnet` is `optional => 0` there and is never in this list.
 *
 * ⚠️ TWO OF THOSE FOUR NAMES ARE HYPHENATED, WHICH NO OTHER FAMILY HERE HAS PUT IN A `delete=`.
 *   The parameter's format is `pve-configid-list`, and a name that failed it would 400 the whole
 *   update rather than skip one field. MEASURED: `$CONFIGID_RE` is `qr/[a-z][a-z0-9_-]+/i`
 *   (JSONSchema.pm:30), so a hyphen after the first character is legal and all four pass.
 */
export const updateForm = (props: SdnSubnetProps): Record<string, string> => {
  const clear = Object.entries(optional(props))
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
  return withClears(body(props), clear);
};

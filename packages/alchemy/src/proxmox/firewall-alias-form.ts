/**
 * A firewall alias on the wire: what PVE stores, and what it quietly changes on the way.
 *
 * ★ SPLIT OUT OF firewall-alias.ts TO KEEP BOTH FILES UNDER THE 250-LINE CAP, and the seam is the
 *   same one metric-server.ts and node-network.ts cut: this file answers "what does the cluster do
 *   to a value", firewall-alias.ts answers "what is an alias and when has it changed". Nothing here
 *   reads the cluster and nothing here decides a diff.
 *
 * ⛔ THE PUT IS A FULL REPLACE, WHICH IS THE EXACT INVERSE OF metric-server.ts — DO NOT COPY THAT
 *   FILE'S RULE OVER HERE. A metric server is a SectionConfig section and a PUT merges into it, so
 *   an omitted field SURVIVES and a managed optional needs a matching `delete=` or it can never be
 *   cleared. An alias is not: `update_alias` builds `$data = { name, cidr }`, adds `comment` only
 *   when it is truthy, and assigns the whole hash over the old one. So an omitted `comment` is
 *   CLEARED here, there is no `delete` parameter on this endpoint at all, and sending
 *   `comment=''` would be a second spelling of the same thing.
 *
 * ⚠️ THE SAME REPLACE MAKES `cidr` REQUIRED ON EVERY UPDATE. PVE's PUT schema does not mark it
 *   optional, and the Perl would build an entry with an undefined cidr if it could — so `body`
 *   below sends it on update as well as on create, rather than treating it as "only send what
 *   changed".
 */
import type { FirewallAliasProps } from './firewall-alias.ts';
import { text } from './values.ts';

/**
 * The alias key, as PVE computes it.
 *
 * ⚠️ EVERY ENTRY POINT LOWERS THE NAME AND NOTHING LOWERS THE STORED ONE: create, read, update and
 *   delete all start `my $name = lc($param->{name})`, while the entry keeps `name => $param->{name}`
 *   as written. So this is identity, and the stored spelling is decoration. Used by `diff` to tell
 *   an edit from a different alias — a comparison of the raw names would call a re-capitalisation a
 *   replace, and delete an alias to put back the same one.
 */
export const fold = (name: string) => name.trim().toLowerCase();

/**
 * A CIDR reduced to the one form PVE will hand back.
 *
 * ⛔ MEASURED by running the cluster's own `PVE::Firewall::parse_alias` on node-b (pve-manager 9.2.11,
 *   2026-09-13) — a pure function over a string, no config read and none written:
 *     `10.1.1.5/32`     -> `10.1.1.5`        a /32 host suffix is STRIPPED
 *     `2001:0DB8::1/128`-> `2001:0DB8::1`    a /128 is stripped, and the case is NOT folded
 *     `2001:db8::/32`   -> `2001:db8::/32`   a /32 on IPv6 is a real prefix and SURVIVES
 *   `parse_ip_or_cidr` is where it happens: `s|/32$||` under the IPv4 branch and `s|/128$||` under
 *   the IPv6 one. Unmatched, a declared `10.1.1.5/32` reads back as `10.1.1.5` and reports an
 *   update on every plan for the rest of time, each deploy writing back a value it already holds.
 *
 * ⛔ SO THE STRIP IS VERSION-AWARE, AND AN UNCONDITIONAL `/32` WOULD CORRUPT THE COMPARISON. A
 *   colon cannot appear in an IPv4 address and must appear in an IPv6 one, which is the whole
 *   discriminator PVE's own two regexes come down to here. Reading `2001:db8::/32` as
 *   `2001:db8::` would make a /32 prefix compare equal to a single host.
 *
 * ⚠️ AND IT STOPS THERE, ON PURPOSE. PVE does not lowercase, zero-pad or compress an IPv6 literal,
 *   so neither may this: it stores what it was handed and gives that back, which means any spelling
 *   is stable once written. Canonicalising further would make `matches` call two DIFFERENT stored
 *   strings equal and report noop over real drift — the same lie as missing a rewrite, pointed the
 *   other way.
 */
export const cidr = (value: unknown) => {
  const raw = text(value).trim();
  const host = raw.includes(':') ? '/128' : '/32';
  return raw.endsWith(host) ? raw.slice(0, -host.length) : raw;
};

/**
 * A comment reduced to the one form PVE will hand back.
 *
 * ⚠️ AN ALIAS COMMENT IS A TRAILING `#` ON ITS LINE IN `cluster.fw`, AND THE ROUND TRIP TRIMS IT.
 *   MEASURED with the same parser run: `Cmt 10.2.0.0/16 #   spaced comment   ` comes back as
 *   `spaced comment`. `parse_alias` strips the surrounding whitespace (`s/\s*#\s*(.*?)\s*$//`) and
 *   `format_aliases` refuses to write a blank one at all, so an untrimmed declaration would diff
 *   against its own stored form forever.
 *
 * ⛔ A COMMENT OF EXACTLY `0` CANNOT BE STORED, AND READING THAT AS DRIFT WOULD LOOP FOREVER.
 *   MEASURED: `Zero 10.3.0.0/16 # 0` parses to an entry with NO comment key. Both the create and
 *   the update guard with Perl's `if $param->{comment}`, and `'0'` is false in Perl — so the string
 *   is dropped before it ever reaches the file, on write as well as on read. Folded to `''` here
 *   because that is what the cluster will do with it: a declaration asking for something PVE will
 *   not keep should plan as noop and be documented, not diff on every plan and be unfixable by the
 *   very PUT the diff asks for.
 *
 * ⚠️ A LINE FEED IS A 400, NOT A TRUNCATION. `pve_fw_verify_comment_spec` dies with "comment must
 *   not contain a line feed", which is the honest answer and is left to PVE rather than silently
 *   flattened here — flattening would store something the declaration did not say.
 */
export const comment = (value: unknown) => {
  const trimmed = text(value).trim();
  return trimmed === '0' ? '' : trimmed;
};

/**
 * Everything mutable, in the form PVE wants. Create adds `name`; update sends exactly this.
 *
 * ⚠️ `name` IS NOT SENT ON UPDATE BECAUSE IT IS ALREADY THE LAST SEGMENT OF THE PATH BEING PUT TO,
 *   and a second copy can only disagree with it — the same reasoning metric-server.ts gives for
 *   omitting its `id`. PVE takes the path segment as `$param->{name}` and writes it back as the
 *   stored spelling, so a PUT for any other reason also re-capitalises the entry to match the
 *   declaration. That is a side effect worth knowing about and not worth causing on its own.
 *
 * ⚠️ THE NORMALISED CIDR IS WHAT GETS WRITTEN, NOT THE DECLARED SPELLING. PVE stores the parameter
 *   verbatim into `cluster.fw` and only strips the host suffix when it reads the file back, so
 *   sending `10.1.1.5` rather than `10.1.1.5/32` leaves the file saying exactly what the next read
 *   will answer. Both settle; this one leaves no pair of values that merely happen to agree.
 *
 * ⚠️ `rename` IS DELIBERATELY ABSENT — see the ⚠️ on renames in firewall-alias.ts. A `rename` in
 *   this form would be a second, invisible identity for the object, set from a field the resource
 *   does not have.
 */
export const body = (props: FirewallAliasProps): Record<string, string> => {
  const note = comment(props.comment);
  return { cidr: cidr(props.cidr), ...(note === '' ? {} : { comment: note }) };
};

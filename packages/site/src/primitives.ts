/**
 * The value shapes a site file is made of. Each one refuses at decode time, naming its path,
 * so a typo fails when the file is read rather than when a plan renames something.
 *
 * ⛔ LOWERCASE ONLY for DNS names. Cloudflare, OpenBao and ssh compare names as strings in
 *   places, and `Mgmt.Example.com` is not `mgmt.example.com` to a principal list.
 */
import * as Schema from 'effect/Schema';

/** One DNS label: `v`, `mgmt`, `n1`. Also the shape of every key a consumer looks up. */
export const Label = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/, {
    message: 'Expected a lowercase DNS label (a-z, 0-9, inner hyphens, at most 63)',
  }),
);

/** A fully qualified name with at least two labels: `example.com`, `shop.example.net`. */
export const Hostname = Schema.String.check(
  Schema.isPattern(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/,
    { message: 'Expected a lowercase fully qualified hostname such as example.com' },
  ),
);

/** A certificate name: a hostname, or one leading wildcard label. */
export const CertificateName = Schema.String.check(
  Schema.isPattern(
    /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/,
    { message: 'Expected a hostname, optionally with one leading *. wildcard' },
  ),
);

const OCTET = '(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])';

/** A dotted-quad IPv4 address, every octet 0–255. */
export const Ipv4 = Schema.String.check(
  Schema.isPattern(new RegExp(`^(${OCTET}\\.){3}${OCTET}$`), {
    message: 'Expected an IPv4 address such as 192.0.2.10',
  }),
);

/** Parse `a.b.c.d/p` into a 32-bit base and a prefix length. `undefined` when malformed. */
export function parseCidr(cidr: string): { base: number; prefix: number } | undefined {
  const match = new RegExp(`^((${OCTET}\\.){3}${OCTET})/([0-9]{1,2})$`).exec(cidr);
  if (match === null) return undefined;
  const prefix = Number(match[match.length - 1]);
  const base = (match[1] ?? '').split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
  return { base, prefix };
}

/**
 * An IPv4 network, `/8` to `/30`, written at its network address.
 *
 * ⚠️ `192.0.2.5/24` is refused, not normalised. A host address with a prefix usually means
 *   someone pasted an interface address where a network belongs; normalising it would hide
 *   the mistake and derive every leg address from the wrong idea of the network.
 */
export const Ipv4Cidr = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      const parsed = parseCidr(value);
      if (parsed === undefined) return 'Expected an IPv4 network such as 192.0.2.0/24';
      if (parsed.prefix < 8 || parsed.prefix > 30) return 'Expected a prefix between /8 and /30';
      const hostBits = 2 ** (32 - parsed.prefix);
      if (parsed.base % hostBits !== 0) return 'Expected the network address (host bits zero)';
      return undefined;
    },
    { expected: 'an IPv4 network' },
  ),
);

/** A host's number on a network: `.11` on a /24 is 11. Checked against the prefix later. */
export const HostNumber = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 16_777_214 }),
);

export const Port = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 1, maximum: 65_535 }),
);

/** A Cloudflare account id: 32 lowercase hex characters. */
export const AccountId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{32}$/, {
    message: 'Expected a 32-character lowercase hex account id',
  }),
);

/** A GitHub user or organisation login. GitHub itself allows uppercase here. */
export const GithubOwner = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/, {
    message: 'Expected a GitHub login (letters, digits, inner hyphens)',
  }),
);

/** An absolute POSIX path with no trailing slash: `/opt/example`. */
export const AbsolutePath = Schema.String.check(
  Schema.isPattern(/^(\/[^/\0]+)+$/, {
    message: 'Expected an absolute path without a trailing slash',
  }),
);

/** A semver version, as npm writes one: `0.1.0`, `1.0.0-rc.1`. */
export const SemVer = Schema.String.check(
  Schema.isPattern(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, { message: 'Expected a semver version' }),
);

/** A key into a `pinned` table: `alerts.d1`, `ssh-host.host`. Dotted, lowercase. */
export const PinKey = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+([._-][a-z0-9]+)*$/, {
    message: 'Expected a lowercase dotted key such as alerts.d1',
  }),
);

/**
 * A physical resource name: Worker, D1, KV, R2, Durable Object class.
 * ★ Case is allowed because Durable Object bindings name PascalCase classes.
 */
export const PhysicalName = Schema.String.check(
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, {
    message: 'Expected a resource name (letters, digits, dot, dash, underscore)',
  }),
);

/**
 * One SSH principal or policy entry.
 * ⛔ No commas and no whitespace. OpenBao stores principal lists comma-joined, so an entry
 *   holding a comma silently becomes two principals, and a stray space becomes a name no
 *   host will ever present.
 */
export const ListEntry = Schema.String.check(
  Schema.isPattern(/^[^\s,]+$/, { message: 'Expected one entry with no commas or whitespace' }),
);

/** A free-form identifier that must not be blank: cluster names, adopted ids, CNs. */
export const NonBlank = Schema.String.check(
  Schema.isPattern(/^\S(.*\S)?$/, { message: 'Expected a non-blank value without edge spaces' }),
);

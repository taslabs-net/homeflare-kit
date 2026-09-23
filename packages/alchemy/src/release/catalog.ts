/**
 * A vendor's pinned releases as DATA, and the one way to turn an entry into Release.Binary props —
 * or into the reasons there is none. Pure: no network, no host.
 *
 * ★ THE DATA SITS BESIDE THE RESOURCE, NOT INSIDE IT. A catalog (victoria.ts is the first) is the
 *   reviewed record of what one vendor published: exact asset names, sizes, both digest layers and
 *   where each was copied from. The resource takes one pinned archive as props and never reads a
 *   catalog, so adding a vendor is a data module with its own walk-down, never a resource change.
 * ★ A VERSION THE CATALOG DOES NOT LIST IS A REFUSAL, NOT A DOWNLOAD ATTEMPT. `catalogBinary()` runs
 *   in the stack's own program — which `alchemy plan` evaluates — so an unknown version, a
 *   `-enterprise` spelling or a `v` prefix fails the plan before any resource is asked anything,
 *   let alone fetches a byte.
 * ⛔ ADD A VENDOR ONLY AFTER ITS OWN WALK-DOWN (docs/release-binary-catalogs.md): its checksum
 *   format read byte-exact, and its binary's linkage measured (`otool -L`). Vendor binaries were
 *   measured self-contained ONLY for the five Victoria ones; that is not a property of "Go".
 * ★ `computed` IS A SECOND, LESSER OWNER OF A MEMBER'S DIGEST — never the vendor's, always ours,
 *   for a checksum file that never lists the member at all (OpenBao: archives and SBOMs only,
 *   never `bao`; docs/release-binary-openbao.md is the walk-down). `checksums.signature` records
 *   how the checksum file's OWN authorship was checked, if a vendor publishes one to check.
 */
import type { ReleaseArchive, ReleaseBinaryProps } from './binary-form.ts';
import { BinaryRefused } from './refused.ts';

/**
 * A member digest WE computed, because the vendor's checksum file never lists it — read
 * checksums.ts's header before adding one: most vendors list archives only.
 */
export interface ComputedDigest {
  readonly sha256: string;
  /** The date it was computed, from the archive whose pinned SHA-256 matched that day. */
  readonly recorded: string;
}

/** How the checksum file itself was checked, beyond its own SHA-256 — openpgp today. */
export interface ChecksumSignature {
  readonly kind: 'openpgp';
  /** The detached signature asset's URL. */
  readonly url: string;
  readonly sha256: string;
  /** The public key it was checked against. */
  readonly key: { readonly url: string; readonly sha256: string; readonly fingerprint: string };
  /** The date `gpgv` was run, recorded once — never re-run at apply or by CI. */
  readonly verified: string;
}

/** One release archive as a catalog records it: the pin, plus where every digest came from. */
export interface PinnedArchive extends ReleaseArchive {
  /** Archive member → its SHA-256. Every member the vendor's checksum file lists, not just ours. */
  readonly members: Readonly<Record<string, string>>;
  /**
   * Archive member → a digest WE computed, for a checksum file that never lists it (OpenBao's
   * lists archives and SBOMs, never `bao`). ⛔ NOT A VENDOR FACT: computed from the bytes of an
   * archive whose own SHA-256 already matched the pin, never filed beside `members`. A member in
   * both is refused (catalogProblems) — two owners of one pin is a data-set bug, not a choice.
   */
  readonly computed?: Readonly<Record<string, ComputedDigest>>;
  /** The checksum file the digests were copied from, its own SHA-256, and when. Never fetched. */
  readonly checksums: {
    readonly url: string;
    readonly sha256: string;
    readonly recorded: string;
    /** How the checksum file's own authorship was checked, if at all. Optional: not every vendor publishes one. */
    readonly signature?: ChecksumSignature;
  };
}

/** One package (one archive per version and platform) of a vendor. */
export interface CatalogPackage {
  /**
   * Installed name → archive member, written out, never derived: a member the vendor adds is
   * installable only once somebody names it here.
   */
  readonly binaries: Readonly<Record<string, string>>;
  /** Version (as the catalog spells it) → platform (the vendor's spelling) → archive. */
  readonly versions: Readonly<Record<string, Readonly<Record<string, PinnedArchive>>>>;
}

/** A vendor's pinned releases. */
export interface ReleaseCatalog {
  /** Who publishes these, for refusals: `'VictoriaMetrics'`. */
  readonly vendor: string;
  readonly packages: Readonly<Record<string, CatalogPackage>>;
}

/** Which binary a stack asks a catalog for. */
export type CatalogRequest = {
  readonly package: string;
  readonly version: string;
  readonly platform: string;
  /** The installed name — `vmalert`, not the member `vmalert-prod`. */
  readonly binary: string;
};

/** The pinned half of Release.Binary's props; the stack adds `directory`, `mode` and owner. */
export type PinnedBinary = Pick<ReleaseBinaryProps, 'archive' | 'member' | 'sha256' | 'name'>;

const quoted = (names: Iterable<string>): string => [...names].map((n) => `"${n}"`).join(', ');

// ★ A plain boolean, not a type guard: on a `Record<string, …>` a guard narrows the miss to `never`.
const has = (record: object, key: string): boolean => Object.hasOwn(record, key);

/**
 * A member's SHA-256, vendor digest first, then computed — or `'both'` when it is pinned in both,
 * which is refused rather than silently preferring one owner over the other.
 */
const memberDigest = (archive: PinnedArchive, member: string): string | 'both' | undefined => {
  const vendor = has(archive.members, member) ? archive.members[member] : undefined;
  const computed =
    archive.computed !== undefined && has(archive.computed, member)
      ? archive.computed[member]?.sha256
      : undefined;
  if (vendor !== undefined && computed !== undefined) return 'both';
  return vendor ?? computed;
};

/** Everything wrong with a request against a catalog; empty when it resolves. */
export const catalogProblems = (catalog: ReleaseCatalog, request: CatalogRequest): string[] => {
  const entry = has(catalog.packages, request.package)
    ? catalog.packages[request.package]
    : undefined;
  if (entry === undefined) {
    return [
      `${catalog.vendor} package "${request.package}" is not in the catalog (${quoted(Object.keys(catalog.packages))})`,
    ];
  }
  const found: string[] = [];
  if (!has(entry.binaries, request.binary)) {
    // ⚠️ The vendor spelling is the likeliest mistake: the member is `vmalert-prod`, the binary
    //   this installs is `vmalert`.
    const member = Object.values(entry.binaries).includes(request.binary);
    const hint = member ? ' (that is the archive member; name the installed binary)' : '';
    found.push(
      `${request.package} has no binary "${request.binary}"${hint}; it has ${quoted(Object.keys(entry.binaries))}`,
    );
  }
  const platforms = has(entry.versions, request.version)
    ? entry.versions[request.version]
    : undefined;
  if (platforms === undefined) {
    found.push(
      `${request.package} ${request.version} is not in the catalog (it pins ${quoted(Object.keys(entry.versions))}); ` +
        'a new version is a reviewed change that pins its digests, never a download of whatever is there',
    );
    return found;
  }
  const archive = has(platforms, request.platform) ? platforms[request.platform] : undefined;
  if (archive === undefined) {
    found.push(
      `${request.package} ${request.version} is not pinned for platform "${request.platform}" (${quoted(Object.keys(platforms))})`,
    );
  } else if (found.length === 0) {
    const member = entry.binaries[request.binary] ?? '';
    const digest = memberDigest(archive, member);
    if (digest === 'both') {
      found.push(
        `${request.package} ${request.version}'s member "${member}" is pinned twice — once as a ` +
          'vendor digest and once as a computed one; a member has exactly one owner',
      );
    } else if (digest === undefined) {
      found.push(
        `${request.package} ${request.version} pins no digest for member "${member}" (checked ` +
          'the vendor checksum file and any computed record)',
      );
    }
  }
  return found;
};

/**
 * The pinned props for one binary out of a catalog. ⛔ Throws BinaryRefused for anything the
 * catalog does not pin — in a stack program, that fails the plan before anything is fetched.
 */
export const catalogBinary = (catalog: ReleaseCatalog, request: CatalogRequest): PinnedBinary => {
  const problems = catalogProblems(catalog, request);
  // ⚠️ Own keys only: `packages.constructor` is Object's, and would read as a package.
  const own = <V>(record: Readonly<Record<string, V>> | undefined, key: string): V | undefined =>
    record !== undefined && has(record, key) ? record[key] : undefined;
  const entry = own(catalog.packages, request.package);
  const archive = own(own(entry?.versions, request.version), request.platform);
  const member = own(entry?.binaries, request.binary);
  const digest =
    member === undefined || archive === undefined ? undefined : memberDigest(archive, member);
  const sha256 = digest === 'both' ? undefined : digest;
  if (
    problems.length > 0 ||
    archive === undefined ||
    member === undefined ||
    sha256 === undefined
  ) {
    throw new BinaryRefused({
      message: `Release.Binary ${request.binary}: ${problems.join('; ')}. Nothing was fetched.`,
    });
  }
  const { asset, repo, root, sha256: archiveSha256, size, tag } = archive;
  return {
    // ⚠️ exactOptionalPropertyTypes: a conditional spread, never `root: undefined` spelled out.
    archive: {
      asset,
      repo,
      sha256: archiveSha256,
      size,
      tag,
      ...(root === undefined ? {} : { root }),
    },
    member,
    name: request.binary,
    sha256,
  };
};

/** `<root>/<package>-<version>`: one directory per version, so an upgrade is a new path. */
export const catalogDirectory = (
  root: string,
  request: Pick<CatalogRequest, 'package' | 'version'>,
): string => `${root}/${request.package}-${request.version}`;

/** What a catalog says an installed binary is, found by its SHA-256 alone. */
export type IdentifiedBinary = CatalogRequest & { readonly vendor: string };

/**
 * Name an installed file by its digest — never by running it. ★ IDENTITY BY SHA-256: the running
 *   Nix victoria-traces reports an empty version (`vm_app_version{version=""}` on /metrics, measured
 *   2026-09-22 — its build sets no buildinfo), a stamped build prints `-version` to STDERR, not
 *   stdout (lib/buildinfo, read, not run), and executing a binary to learn what it is runs the very
 *   bytes whose provenance is the question. A digest needs a read, nothing more.
 */
export const identifyBinary = (
  catalogs: readonly ReleaseCatalog[],
  sha256: string,
): IdentifiedBinary | undefined => {
  for (const catalog of catalogs) {
    for (const [pkg, entry] of Object.entries(catalog.packages)) {
      for (const [version, platforms] of Object.entries(entry.versions)) {
        for (const [platform, archive] of Object.entries(platforms)) {
          for (const [binary, member] of Object.entries(entry.binaries)) {
            const digest = memberDigest(archive, member);
            if (digest !== 'both' && digest === sha256) {
              return { binary, package: pkg, platform, vendor: catalog.vendor, version };
            }
          }
        }
      }
    }
  }
  return undefined;
};

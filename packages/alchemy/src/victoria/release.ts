/**
 * From a declaration to the one archive and the one member it means — or the reasons it means
 * none. Pure: no network, no host. The catalog is a parameter so tests can pin synthetic archives;
 * every provider path passes VICTORIA_CATALOG.
 *
 * ★ A VERSION THE CATALOG DOES NOT LIST IS A REFUSAL, NOT A DOWNLOAD ATTEMPT. Resolving is the first
 *   thing read, diff and reconcile do, so an unknown version, a `-enterprise` spelling or a `v`
 *   prefix fails the plan (or, for a create whose props held an Output, the apply) before any byte
 *   is fetched or any host is asked anything.
 */
import {
  type PinnedArchive,
  VICTORIA_CATALOG,
  type VictoriaCatalog,
  type VictoriaPackage,
  type VictoriaPackageEntry,
  type VictoriaPlatform,
} from './catalog.ts';

/** Which binary a declaration asks for, before anything is resolved. */
export type VictoriaRequest = {
  readonly package: string;
  readonly version: string;
  readonly platform: string;
  readonly binary: string;
};

/** The one archive and member a declaration means, with every digest it will be checked against. */
export type ResolvedRelease = {
  readonly url: string;
  readonly size: number;
  /** The archive's pinned SHA-256. */
  readonly sha256: string;
  /** The archive member to extract, by exact name: `vmalert-prod`. */
  readonly member: string;
  /** The member's pinned SHA-256 — what the installed file must hash to. */
  readonly memberSha256: string;
  /** The vendor checksum file the pins were copied from. */
  readonly checksumsUrl: string;
};

const quoted = (names: Iterable<string>): string => [...names].map((n) => `"${n}"`).join(', ');

// ★ A plain boolean, not a type guard: on a `Record<string, …>` a guard narrows the miss to `never`.
const has = (record: object, key: string): boolean => Object.hasOwn(record, key);

/** Everything wrong with a request against the catalog; empty when it resolves. */
export const releaseProblems = (
  request: VictoriaRequest,
  catalog: VictoriaCatalog = VICTORIA_CATALOG,
): string[] => {
  if (!has(catalog, request.package)) {
    return [`package "${request.package}" is not in the catalog (${quoted(Object.keys(catalog))})`];
  }
  const entry = catalog[request.package as VictoriaPackage];
  const found: string[] = [];
  if (!has(entry.binaries, request.binary)) {
    // ⚠️ The vendor spelling is the likeliest mistake: the member is `vmalert-prod`, the binary
    //   this installs is `vmalert`.
    const hint = request.binary.endsWith('-prod')
      ? ' (name the installed binary, without -prod)'
      : '';
    found.push(
      `${request.package} has no binary "${request.binary}"${hint}; it has ${quoted(Object.keys(entry.binaries))}`,
    );
  }
  if (!has(entry.versions, request.version)) {
    found.push(
      `${request.package} ${request.version} is not in the catalog (it pins ${quoted(Object.keys(entry.versions))}); ` +
        'a new version is a kit change that pins its digests, never a download of whatever is there',
    );
    return found;
  }
  const platforms = entry.versions[request.version] ?? {};
  const archive = has(platforms, request.platform)
    ? platforms[request.platform as VictoriaPlatform]
    : undefined;
  if (archive === undefined) {
    found.push(
      `${request.package} ${request.version} is not pinned for platform "${request.platform}" (${quoted(Object.keys(platforms))})`,
    );
  } else if (found.length === 0) {
    const member = entry.binaries[request.binary] ?? '';
    if (!has(archive.members, member)) {
      found.push(
        `${request.package} ${request.version}'s checksum file lists no member "${member}"`,
      );
    }
  }
  return found;
};

/** The archive and member a request means. ⚠️ Throws the joined problems; check releaseProblems first. */
export const resolveVictoriaRelease = (
  request: VictoriaRequest,
  catalog: VictoriaCatalog = VICTORIA_CATALOG,
): ResolvedRelease => {
  const problems = releaseProblems(request, catalog);
  if (problems.length > 0) throw new Error(problems.join('; '));
  const entry = catalog[request.package as VictoriaPackage];
  const archive = entry.versions[request.version]?.[request.platform as VictoriaPlatform];
  const member = entry.binaries[request.binary];
  const memberSha256 = member === undefined ? undefined : archive?.members[member];
  if (archive === undefined || member === undefined || memberSha256 === undefined) {
    throw new Error('unreachable: releaseProblems passed a request it cannot resolve');
  }
  return {
    checksumsUrl: archive.checksums.url,
    member,
    memberSha256,
    sha256: archive.sha256,
    size: archive.size,
    url: archive.url,
  };
};

/** What the catalog says an installed binary is, found by its SHA-256 alone. */
export type IdentifiedBinary = {
  readonly package: VictoriaPackage;
  readonly version: string;
  readonly platform: VictoriaPlatform;
  readonly binary: string;
};

/**
 * Name an installed file by its digest — never by running it. ★ IDENTITY BY SHA-256: the running
 *   Nix victoria-traces reports an empty version (`vm_app_version{version=""}` on /metrics, measured
 *   2026-09-22 — its build sets no buildinfo), a stamped build prints `-version` to STDERR, not
 *   stdout (lib/buildinfo, read, not run), and executing a binary to learn what it is runs the very
 *   bytes whose provenance is the question. A digest needs a read, nothing more.
 */
export const identifyVictoriaBinary = (
  sha256: string,
  catalog: VictoriaCatalog = VICTORIA_CATALOG,
): IdentifiedBinary | undefined => {
  for (const [pkg, entry] of Object.entries(catalog) as [VictoriaPackage, VictoriaPackageEntry][]) {
    for (const [version, platforms] of Object.entries(entry.versions)) {
      for (const [platform, archive] of Object.entries(platforms) as [
        VictoriaPlatform,
        PinnedArchive,
      ][]) {
        for (const [binary, member] of Object.entries(entry.binaries)) {
          if (archive.members[member] === sha256)
            return { binary, package: pkg, platform, version };
        }
      }
    }
  }
  return undefined;
};

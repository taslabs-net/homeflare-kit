/**
 * Synthetic release archives for the tests beside it: a tar writer, gzip, a catalog pinned to what
 * they build, a counting transport, and a host with the versioned directories in place.
 *
 * ⛔ TEST-ONLY. No provider imports this file, it is not on the barrel, and nothing here reaches a
 *   network or a real filesystem. The catalog is synthetic because a test cannot build bytes that
 *   hash to the vendor's pins; catalog.test.ts holds the REAL catalog to the vendor's own files.
 * ★ THE URLS ARE THE REAL ONES, so a test that serves the `-enterprise` sibling next to the plain
 *   archive proves the provider asks for exactly one of them.
 */
import { fakeRunner } from '../launchd/fake-runner.ts';
import { sha256Hex } from '../launchd/job-form.ts';
import { type PinnedArchive, VICTORIA_CATALOG, type VictoriaCatalog } from './catalog.ts';
import type { FetchArchive } from './download.ts';
import { DownloadFailed } from './refused.ts';

export type TarEntry = {
  readonly name: string;
  readonly bytes?: Uint8Array;
  /** The typeflag: '0' regular (default), '1' hard link, '2' symlink, '5' directory, 'L', 'x', … */
  readonly type?: string;
  readonly format?: 'gnu' | 'posix';
  readonly prefix?: string;
  /** Size field written as GNU base-256. */
  readonly base256?: boolean;
  readonly corruptChecksum?: boolean;
};

const put = (block: Uint8Array, at: number, text: string) =>
  block.set(new TextEncoder().encode(text), at);
const octal = (value: number, width: number) => `${value.toString(8).padStart(width - 1, '0')}\0`;

export const tarHeader = (entry: TarEntry): Uint8Array => {
  const block = new Uint8Array(512);
  const size = entry.bytes?.length ?? 0;
  put(block, 0, entry.name);
  put(block, 100, octal(0o755, 8));
  put(block, 108, octal(1000, 8));
  put(block, 116, octal(1000, 8));
  if (entry.base256 === true) block.set([0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, size], 124);
  else put(block, 124, octal(size, 12));
  put(block, 136, octal(1_750_000_000, 12));
  block.fill(0x20, 148, 156);
  put(block, 156, entry.type ?? '0');
  put(block, 257, entry.format === 'posix' ? 'ustar\u000000' : 'ustar  \u0000');
  if (entry.prefix !== undefined) put(block, 345, entry.prefix);
  const sum = block.reduce((total, byte) => total + byte, 0) + (entry.corruptChecksum ? 1 : 0);
  put(block, 148, `${sum.toString(8).padStart(6, '0')}\0 `);
  return block;
};

/** A tar: each header, its data padded to 512, then the two zero blocks. */
export const tarOf = (entries: readonly TarEntry[], end = 1024): Uint8Array => {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    blocks.push(tarHeader(entry));
    const bytes = entry.bytes ?? new Uint8Array();
    const padded = new Uint8Array(Math.ceil(bytes.length / 512) * 512);
    padded.set(bytes);
    blocks.push(padded);
  }
  blocks.push(new Uint8Array(end));
  const out = new Uint8Array(blocks.reduce((total, block) => total + block.length, 0));
  let at = 0;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  return out;
};

export const gzip = (bytes: Uint8Array): Uint8Array => Bun.gzipSync(bytes.slice());

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

/** Stand-ins for the vendor binaries: distinct bytes, so each digest is distinct. */
export const BINARY = {
  vmagent: bytesOf('#!fake vmagent 1.151.0\n'),
  vmalert: bytesOf('#!fake vmalert 1.151.0\n'),
  vmauth: bytesOf('#!fake vmauth 1.151.0\n'),
  'victoria-traces': bytesOf('#!fake victoria-traces 0.10.0\n'),
};

const present = (archive: PinnedArchive | undefined): PinnedArchive => {
  if (archive === undefined) throw new Error('the catalog lost a pinned archive');
  return archive;
};
export const VMUTILS = present(VICTORIA_CATALOG.vmutils.versions['1.151.0']?.['darwin-arm64']);
export const TRACES = present(
  VICTORIA_CATALOG['victoria-traces'].versions['0.10.0']?.['darwin-arm64'],
);
export const ENTERPRISE_URL = VMUTILS.url.replace('.tar.gz', '-enterprise.tar.gz');

export const VMUTILS_ENTRIES: readonly TarEntry[] = [
  { bytes: BINARY.vmagent, name: 'vmagent-prod' },
  { bytes: BINARY.vmalert, name: 'vmalert-prod' },
  { bytes: BINARY.vmauth, name: 'vmauth-prod' },
];

/** Pin an archive the way catalog.ts pins a vendor one, from the bytes themselves. */
export const pinned = (
  real: PinnedArchive,
  archive: Uint8Array,
  members: Readonly<Record<string, Uint8Array>>,
): PinnedArchive => ({
  ...real,
  members: Object.fromEntries(Object.entries(members).map(([n, b]) => [n, sha256Hex(b)])),
  sha256: sha256Hex(archive),
  size: archive.length,
});

/** The real catalog with vmutils 1.151.0 and victoria-traces 0.10.0 re-pinned to synthetic bytes. */
export const syntheticRelease = (vmutilsEntries: readonly TarEntry[] = VMUTILS_ENTRIES) => {
  const vmutils = gzip(tarOf(vmutilsEntries));
  const traces = gzip(tarOf([{ bytes: BINARY['victoria-traces'], name: 'victoria-traces-prod' }]));
  const memberBytes = Object.fromEntries(
    vmutilsEntries.map((entry) => [entry.name, entry.bytes ?? new Uint8Array()]),
  );
  const catalog: VictoriaCatalog = {
    ...VICTORIA_CATALOG,
    'victoria-traces': {
      ...VICTORIA_CATALOG['victoria-traces'],
      versions: {
        '0.10.0': {
          'darwin-arm64': pinned(TRACES, traces, {
            'victoria-traces-prod': BINARY['victoria-traces'],
          }),
        },
      },
    },
    vmutils: {
      ...VICTORIA_CATALOG.vmutils,
      versions: { '1.151.0': { 'darwin-arm64': pinned(VMUTILS, vmutils, memberBytes) } },
    },
  };
  return { catalog, traces, vmutils };
};

/** A transport over a URL → bytes table that records every request, in order. */
export const fakeTransport = (served: Readonly<Record<string, Uint8Array>>) => {
  const requests: string[] = [];
  const fetch: FetchArchive = async (url) => {
    requests.push(url);
    const bytes = served[url];
    if (bytes === undefined)
      throw new DownloadFailed({ message: `${url}: HTTP 404`, retryable: false });
    return bytes;
  };
  return { fetch, requests };
};

export const ROOT = '/opt/example/bin';
export const VMUTILS_DIR = `${ROOT}/vmutils-1.151.0`;
export const TRACES_DIR = `${ROOT}/victoria-traces-0.10.0`;

/** A host deploying as root, with the two versioned directories already declared. */
export const victoriaHost = () =>
  fakeRunner({ dirs: { [ROOT]: 0, [TRACES_DIR]: 0, [VMUTILS_DIR]: 0 }, euid: 0 });

export const VMALERT = {
  binary: 'vmalert',
  directory: VMUTILS_DIR,
  package: 'vmutils',
  platform: 'darwin-arm64',
  version: '1.151.0',
} as const;

/** Every path on the fake host, sorted — equal before and after means nothing was left behind. */
export const pathsOn = (fake: ReturnType<typeof fakeRunner>): string[] =>
  [...fake.files.keys()].sort();

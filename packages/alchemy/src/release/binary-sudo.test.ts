/**
 * The install through the kit's REAL sudoRunner over its fake host (launchd/fake-sudo.ts), so what
 * is asserted is the runner's own staging, not a fake's: the verified bytes reach root's directory
 * as one `install -S` of one staged file, and no failure — before the write or during it — leaves a
 * staged file behind.
 *
 * ★ WHY THIS IS THE STAGING TEST. Release.Binary stages nothing itself: the archive and the member
 *   live in memory (archive.ts). The only staged file in an install is the runner's — local-runner's
 *   same-directory temp file (local-runner.test.ts: "leaves no temp file behind") or, here,
 *   sudoRunner's 0600 file in a 0700 directory.
 */
import { describe, expect, test } from 'bun:test';
import { fakeSudoHost } from '../launchd/fake-sudo.ts';
import { INSTALL } from '../launchd/sudo-allowlist.ts';
import type { ReleaseBinaryProps } from './binary-form.ts';
import { reconcileBinary } from './binary-lifecycle.ts';
import {
  BINARY,
  type TarEntry,
  VMUTILS_ENTRIES,
  VMUTILS_URL,
  bytesOf,
  fakeTransport,
  gzip,
  syntheticRelease,
  tarOf,
  vmalertProps,
} from './fake-release.ts';

const DIR = '/opt/example/app/vmutils-1.151.0';
const PATH = `${DIR}/vmalert`;

type Setup = {
  /** What the transport serves at the vmutils URL; undefined serves nothing (a 404). */
  readonly served?: (release: ReturnType<typeof syntheticRelease>) => Uint8Array | undefined;
  readonly entries?: readonly TarEntry[];
  readonly declare?: Partial<ReleaseBinaryProps>;
};

const setup = ({ declare = {}, entries, served = (r) => r.vmutils }: Setup = {}) => {
  const release = syntheticRelease(entries);
  const host = fakeSudoHost();
  host.fake.dirs.set(DIR, 0);
  const bytes = served(release);
  const transport = fakeTransport(bytes === undefined ? {} : { [VMUTILS_URL]: bytes });
  const props = vmalertProps(release.catalog, { directory: DIR, group: 0, owner: 0, ...declare });
  const install = () => reconcileBinary(host.runner, transport.fetch, props);
  return { host, install, transport };
};

describe('Release.Binary through sudoRunner', () => {
  test('one staged file, one exact install, and the staged file removed', async () => {
    const { host, install } = setup();
    const attrs = await install();
    expect(host.privileged()).toEqual([
      [INSTALL, '-S', '-m', '0755', '-o', '0', '-g', '0', expect.any(String), PATH],
    ]);
    expect(host.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
    expect(attrs).toMatchObject({ gid: 0, mode: 0o755, uid: 0 });
    expect(host.state.stagedCount).toBe(1);
    expect(host.staged.size).toBe(0);
  });

  test('a failed install throws and leaves no staged file and no binary', async () => {
    const { host, install } = setup();
    host.state.installFailure = { exitCode: 71, stderr: 'install: disk full', stdout: '' };
    await expect(install()).rejects.toThrow('disk full');
    expect(host.state.stagedCount).toBe(1);
    expect(host.staged.size).toBe(0);
    expect(host.fake.files.has(PATH)).toBe(false);
  });

  // ⛔ EVERY failure before the write: nothing is staged at all, sudo is never asked, no binary.
  const tampered = () =>
    gzip(tarOf(VMUTILS_ENTRIES.map((e) => ({ ...e, bytes: bytesOf('evil') }))));
  test.each<[string, Setup]>([
    ['a wrong archive hash', { served: tampered }],
    ['a wrong binary hash', { declare: { sha256: 'f'.repeat(64) } }],
    ['a tar-slip entry', { entries: [...VMUTILS_ENTRIES, { bytes: bytesOf('x'), name: '../x' }] }],
    ['the member as a symlink', { entries: [{ name: 'vmalert-prod', type: '2' }] }],
    ['the member missing', { entries: [{ bytes: BINARY.vmagent, name: 'vmagent-prod' }] }],
    ['a failed download', { served: () => undefined }],
    ['a malformed pin', { declare: { sha256: 'not-a-digest' } }],
    ['an unwritable mode', { declare: { mode: 0o777 } }],
  ])('%s stages nothing, asks sudo nothing, writes nothing', async (_, how) => {
    const { host, install } = setup(how);
    await expect(install()).rejects.toThrow();
    expect(host.state.stagedCount).toBe(0);
    expect(host.staged.size).toBe(0);
    expect(host.sudoCalls).toEqual([]);
    expect(host.fake.files.has(PATH)).toBe(false);
  });
});

/**
 * The install through the kit's REAL sudoRunner over its fake host (launchd/fake-sudo.ts), so what
 * is asserted is the runner's own staging, not a fake's: the verified bytes reach root's directory
 * as one `install -S` of one staged file, and no failure — before the write or during it — leaves a
 * staged file behind.
 *
 * ★ WHY THIS IS THE STAGING TEST. Victoria.Binary stages nothing itself: the archive and the member
 *   live in memory (archive.ts). The only staged file in an install is the runner's — local-runner's
 *   same-directory temp file (local-runner.test.ts: "leaves no temp file behind") or, here,
 *   sudoRunner's 0600 file in a 0700 directory.
 */
import { describe, expect, test } from 'bun:test';
import { fakeSudoHost } from '../launchd/fake-sudo.ts';
import { INSTALL } from '../launchd/sudo-allowlist.ts';
import { reconcileBinary } from './binary-lifecycle.ts';
import {
  BINARY,
  VMALERT,
  VMUTILS,
  VMUTILS_ENTRIES,
  bytesOf,
  fakeTransport,
  gzip,
  syntheticRelease,
  tarOf,
} from './fake-release.ts';
import { ChecksumMismatch } from './refused.ts';

const DIR = '/opt/example/app/vmutils-1.151.0';
const PATH = `${DIR}/vmalert`;
const DECLARED = { ...VMALERT, directory: DIR, group: 0, owner: 0 } as never;

const setup = (served?: Uint8Array) => {
  const { catalog, vmutils } = syntheticRelease();
  const host = fakeSudoHost();
  host.fake.dirs.set(DIR, 0);
  const transport = fakeTransport({ [VMUTILS.url]: served ?? vmutils });
  const install = () => reconcileBinary(host.runner, transport.fetch, DECLARED, { catalog });
  return { host, install, transport };
};

describe('Victoria.Binary through sudoRunner', () => {
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
    expect(host.staged.size).toBe(0);
    expect(host.fake.files.has(PATH)).toBe(false);
  });

  test('a refused archive stages nothing at all, and sudo is never asked', async () => {
    const tampered = gzip(tarOf(VMUTILS_ENTRIES.map((e) => ({ ...e, bytes: bytesOf('evil') }))));
    const { host, install } = setup(tampered);
    await expect(install()).rejects.toBeInstanceOf(ChecksumMismatch);
    expect(host.state.stagedCount).toBe(0);
    expect(host.sudoCalls).toEqual([]);
    expect(host.fake.files.has(PATH)).toBe(false);
  });
});

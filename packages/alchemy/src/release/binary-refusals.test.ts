/**
 * Every refusal of the install lifecycle, each asserted by what it LEFT (fake-install.ts): the
 * transport's request log, the host's write log, and the host's paths before and after.
 */
import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '../launchd/job-form.ts';
import type { ReleaseBinaryProps } from './binary-form.ts';
import { reconcileBinary } from './binary-lifecycle.ts';
import {
  BINARY,
  VMUTILS_DIR,
  VMUTILS_ENTRIES,
  VMUTILS_URL,
  bytesOf,
  fakeTransport,
  gzip,
  pathsOn,
  tarOf,
} from './fake-release.ts';
import { PATH, refused, setup } from './fake-install.ts';
import { ArchiveRefused, BinaryRefused, ChecksumMismatch, DownloadFailed } from './refused.ts';

describe('refusals leave the host exactly as it was', () => {
  test('a wrong archive hash', async () => {
    const s = setup();
    const tampered = gzip(tarOf(VMUTILS_ENTRIES.map((e) => ({ ...e, bytes: bytesOf('evil') }))));
    const transport = fakeTransport({ [VMUTILS_URL]: tampered });
    const error = await refused(s, () =>
      reconcileBinary(s.fake.runner, transport.fetch, s.props()),
    );
    expect(error).toBeInstanceOf(ChecksumMismatch);
    expect(error.message).toContain(`Release.Binary ${PATH}: ${VMUTILS_URL} hashes to`);
    expect(error.message).toContain('Nothing was written.');
  });

  test('the right archive with a wrong binary pin', async () => {
    const s = setup();
    const error = await refused(s, () => s.install(s.props({ sha256: 'f'.repeat(64) })));
    expect(error).toBeInstanceOf(ChecksumMismatch);
    expect(error.message).toContain(`member "vmalert-prod" hashes to ${sha256Hex(BINARY.vmalert)}`);
  });

  test('a tar-slip entry beside the declared member, in a correctly pinned archive', async () => {
    const s = setup([
      ...VMUTILS_ENTRIES,
      { bytes: bytesOf('pwn'), name: '../../../etc/sudoers.d/x' },
    ]);
    const error = await refused(s, () => s.install());
    expect(error).toBeInstanceOf(ArchiveRefused);
    expect(error.message).toContain('climbs out');
  });

  test('the declared member as a symlink', async () => {
    const s = setup([{ name: 'vmalert-prod', type: '2' }]);
    expect(await refused(s, () => s.install())).toBeInstanceOf(ArchiveRefused);
  });

  test('the declared member missing from a correctly pinned archive', async () => {
    const s = setup([{ bytes: BINARY.vmagent, name: 'vmagent-prod' }]);
    const error = await refused(s, () => s.install());
    expect(error.message).toContain(
      'no member named exactly "vmalert-prod" (it has "vmagent-prod")',
    );
  });

  test('a failed download', async () => {
    const s = setup();
    const error = await refused(s, () =>
      reconcileBinary(s.fake.runner, fakeTransport({}).fetch, s.props()),
    );
    expect(error).toBeInstanceOf(DownloadFailed);
    expect(error.message).toContain(`Release.Binary ${PATH}:`);
  });

  const archive = (more: object) => (p: ReleaseBinaryProps) => ({
    archive: { ...p.archive, ...more },
  });
  test.each([
    ['an archive digest that is not hex', archive({ sha256: 'abc' })],
    ['an asset given as a glob', archive({ asset: 'vmutils-darwin-arm64-*.tar.gz' })],
    ['an asset that is not a tarball', archive({ asset: 'vmutils-darwin-arm64-v1.151.0.zip' })],
    ['a repo that climbs', archive({ repo: '../VictoriaMetrics' })],
    ['a tag with a slash', archive({ tag: 'v1.151.0/../x' })],
    ['no size', archive({ size: 0 })],
    ['a size past the one-gibibyte ceiling', archive({ size: 2 ** 30 + 1 })],
    ['a repo named ..', archive({ repo: 'VictoriaMetrics/..' })],
    ['an upper-case member digest', () => ({ sha256: 'A'.repeat(64) })],
    ['an absolute member', () => ({ member: '/vmalert-prod' })],
    ['a member that climbs', () => ({ member: '../vmalert-prod' })],
    ['a name with a slash', () => ({ name: 'bin/vmalert' })],
    ['a relative directory', () => ({ directory: 'bin/vmutils-1.151.0' })],
    ['a setuid mode', () => ({ mode: 0o4755 })],
    ['a group-writable mode', () => ({ mode: 0o775 })],
  ])('%s: refused before any host call or download', async (_, change) => {
    const s = setup();
    s.fake.calls.length = 0;
    const base = s.props();
    const error = await refused(s, () =>
      s.install({ ...base, ...change(base) } as ReleaseBinaryProps),
    );
    expect(error).toBeInstanceOf(BinaryRefused);
    expect(s.transport.requests).toEqual([]);
    expect(s.fake.calls).toEqual([]);
  });

  test('a new pin at the same path: refused, the installed binary untouched', async () => {
    const s = setup();
    const olds = s.props();
    const output = await s.install(olds);
    s.transport.requests.length = 0;
    s.fake.calls.length = 0;
    const bumped = s.props({
      archive: { ...olds.archive, tag: 'v1.152.0' },
      sha256: 'e'.repeat(64),
    });
    const error = await refused(s, () => s.install(bumped, { olds, output }));
    expect(error.message).toContain('would overwrite it in place');
    expect(s.transport.requests).toEqual([]);
    expect(s.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
  });

  test('a missing directory: refused before the download', async () => {
    const s = setup();
    s.fake.dirs.delete(VMUTILS_DIR);
    const error = await refused(s, () => s.install());
    expect(error.message).toContain(`directory ${VMUTILS_DIR} does not exist`);
    expect(s.transport.requests).toEqual([]);
  });

  test('a file this resource does not own, without --adopt: refused before the download', async () => {
    const s = setup();
    s.fake.files.set(PATH, { bytes: bytesOf('theirs'), gid: 0, kind: 'file', mode: 0o755, uid: 0 });
    const error = await refused(s, () => s.install());
    expect(error.message).toContain('already exists and is not this resource');
    expect(s.transport.requests).toEqual([]);
  });

  test('a write that does not read back as declared: the create is rolled back', async () => {
    const s = setup();
    const write = s.fake.runner.writeFileAtomic;
    s.fake.runner.writeFileAtomic = (path, bytes, options) =>
      write(path, bytes, { ...options, mode: 0o700 });
    const before = pathsOn(s.fake);
    await expect(s.install()).rejects.toThrow('does not match the declaration');
    expect(pathsOn(s.fake)).toEqual(before);
  });
});

/**
 * The install lifecycle over a fake host (launchd/fake-runner.ts) and a fake transport — no network,
 * no real filesystem. Each refusal is asserted by what it LEFT: the transport's request log, the
 * host's write log, and the host's paths before and after, which must be equal.
 */
import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '../launchd/job-form.ts';
import { deleteBinary, readBinary, reconcileBinary } from './binary-lifecycle.ts';
import type { VictoriaCatalog } from './catalog.ts';
import {
  BINARY,
  ENTERPRISE_URL,
  TRACES,
  VMALERT,
  VMUTILS,
  VMUTILS_DIR,
  VMUTILS_ENTRIES,
  bytesOf,
  fakeTransport,
  gzip,
  pathsOn,
  syntheticRelease,
  tarOf,
  victoriaHost,
} from './fake-release.ts';
import { ArchiveRefused, BinaryRefused, ChecksumMismatch, DownloadFailed } from './refused.ts';

const PATH = `${VMUTILS_DIR}/vmalert`;
const writes = (fake: ReturnType<typeof victoriaHost>) =>
  fake.calls.filter((c) => c[0] === 'write');

/** A host, a synthetic release served at the real URLs (plus an enterprise decoy), and a runner. */
const setup = (entries = VMUTILS_ENTRIES) => {
  const { catalog, traces, vmutils } = syntheticRelease(entries);
  const decoy = gzip(tarOf([{ bytes: bytesOf('#!enterprise\n'), name: 'vmalert-prod' }]));
  const transport = fakeTransport({
    [ENTERPRISE_URL]: decoy,
    [TRACES.url]: traces,
    [VMUTILS.url]: vmutils,
  });
  const fake = victoriaHost();
  const install = (props = VMALERT as never, options = {}) =>
    reconcileBinary(fake.runner, transport.fetch, props, { catalog, ...options });
  return { catalog, fake, install, transport, vmutils };
};

/** The same catalog with vmalert-prod's pin replaced — the archive's own pin untouched. */
const repin = (catalog: VictoriaCatalog, pin: string): VictoriaCatalog => {
  const archive = catalog.vmutils.versions['1.151.0']?.['darwin-arm64'];
  if (archive === undefined) throw new Error('no archive');
  const members = { ...archive.members, 'vmalert-prod': pin };
  const versions = { '1.151.0': { 'darwin-arm64': { ...archive, members } } };
  return { ...catalog, vmutils: { ...catalog.vmutils, versions } };
};

/** Run a refusal; return it, having checked the host is exactly as it was and nothing was written. */
const refused = async (s: ReturnType<typeof setup>, run: () => Promise<unknown>) => {
  const before = pathsOn(s.fake);
  const error = await run().then(
    () => {
      throw new Error('expected a refusal');
    },
    (cause: unknown) => cause,
  );
  expect(pathsOn(s.fake)).toEqual(before);
  expect(writes(s.fake)).toEqual([]);
  return error as Error;
};

describe('installing', () => {
  test('the declared member, from the plain archive only, verified, at <directory>/<binary>', async () => {
    const s = setup();
    const notes: string[] = [];
    const attrs = await s.install(VMALERT as never, {
      note: async (m: string) => void notes.push(m),
    });
    expect(s.transport.requests).toEqual([VMUTILS.url]);
    expect(s.transport.requests).not.toContain(ENTERPRISE_URL);
    expect(s.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
    expect(attrs).toMatchObject({
      member: 'vmalert-prod',
      mode: 0o755,
      path: PATH,
      url: VMUTILS.url,
    });
    expect(attrs.sha256).toBe(sha256Hex(BINARY.vmalert));
    // ⛔ vmagent-prod and vmauth-prod were in the archive; neither was written anywhere.
    expect(pathsOn(s.fake)).toEqual([PATH]);
    expect(notes[0]).toContain('downloading');
  });

  test('already installed and matching: no download, no write', async () => {
    const s = setup();
    const output = await s.install();
    s.transport.requests.length = 0;
    s.fake.calls.length = 0;
    await s.install(VMALERT as never, { output });
    expect(s.transport.requests).toEqual([]);
    expect(writes(s.fake)).toEqual([]);
  });

  test('the right bytes with the wrong mode: re-written from disk, not downloaded', async () => {
    const s = setup();
    const output = await s.install();
    s.transport.requests.length = 0;
    const fixed = await s.install({ ...VMALERT, mode: 0o555 } as never, { output });
    expect(fixed.mode).toBe(0o555);
    expect(s.transport.requests).toEqual([]);
  });

  test('⚠️ unprobed, the pinned bytes at the path are a resumed install: kept, not fetched', async () => {
    const s = setup();
    s.fake.files.set(PATH, { bytes: BINARY.vmalert, gid: 0, kind: 'file', mode: 0o755, uid: 0 });
    expect((await s.install()).sha256).toBe(sha256Hex(BINARY.vmalert));
    expect([s.transport.requests, writes(s.fake)]).toEqual([[], []]);
  });

  test('a new version is a new path: written, then the old one removed', async () => {
    const s = setup();
    const old = { ...(await s.install()), path: '/opt/example/bin/vmutils-1.150.0/vmalert' };
    s.fake.files.set(old.path, {
      bytes: bytesOf('old'),
      gid: 0,
      kind: 'file',
      mode: 0o755,
      uid: 0,
    });
    await s.install(VMALERT as never, { output: old });
    expect(s.fake.files.has(old.path)).toBe(false);
    expect(s.fake.files.has(PATH)).toBe(true);
  });
});

describe('refusals leave the host exactly as it was', () => {
  test('a wrong archive hash', async () => {
    const s = setup();
    const tampered = gzip(tarOf(VMUTILS_ENTRIES.map((e) => ({ ...e, bytes: bytesOf('evil') }))));
    const transport = fakeTransport({ [VMUTILS.url]: tampered });
    const error = await refused(s, () =>
      reconcileBinary(s.fake.runner, transport.fetch, VMALERT as never, { catalog: s.catalog }),
    );
    expect(error).toBeInstanceOf(ChecksumMismatch);
    expect(error.message).toContain(`Victoria.Binary ${PATH}: ${VMUTILS.url} hashes to`);
    expect(error.message).toContain('Nothing was written.');
  });

  test('the right archive with a wrong binary pin', async () => {
    const s = setup();
    const catalog = repin(s.catalog, 'f'.repeat(64));
    const error = await refused(s, () => s.install(VMALERT as never, { catalog }));
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
    const catalog = repin(s.catalog, sha256Hex(BINARY.vmalert));
    const error = await refused(s, () => s.install(VMALERT as never, { catalog }));
    expect(error.message).toContain(
      'no member named exactly "vmalert-prod" (it has "vmagent-prod")',
    );
  });

  test('a failed download', async () => {
    const s = setup();
    const transport = fakeTransport({});
    const error = await refused(s, () =>
      reconcileBinary(s.fake.runner, transport.fetch, VMALERT as never, { catalog: s.catalog }),
    );
    expect(error).toBeInstanceOf(DownloadFailed);
    expect(error.message).toContain(`Victoria.Binary ${PATH}:`);
  });

  test.each([
    [
      'a version outside the catalog',
      { version: '1.152.0', directory: '/opt/example/bin/vmutils-1.152.0' },
    ],
    ['an enterprise version', { version: '1.151.0-enterprise' }],
    ['a directory without <package>-<version>', { directory: '/opt/example/bin' }],
    ['a relative directory', { directory: 'bin/vmutils-1.151.0' }],
    ['a setuid mode', { mode: 0o4755 }],
    ['a group-writable mode', { mode: 0o775 }],
    ['a pin that is not the catalog pin', { sha256: 'a'.repeat(64) }],
  ])('%s: refused before any host call or download', async (_, change) => {
    const s = setup();
    s.fake.calls.length = 0;
    const error = await refused(s, () => s.install({ ...VMALERT, ...change } as never));
    expect(error).toBeInstanceOf(BinaryRefused);
    expect(s.transport.requests).toEqual([]);
    expect(s.fake.calls).toEqual([]);
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

describe('read and delete', () => {
  test('read reports the file at the path by its digest; delete removes it, twice', async () => {
    const s = setup();
    expect(await readBinary(s.fake.runner, VMALERT as never, s.catalog)).toBeUndefined();
    const output = await s.install();
    expect((await readBinary(s.fake.runner, VMALERT as never, s.catalog))?.sha256).toBe(
      output.sha256,
    );
    await deleteBinary(s.fake.runner, output);
    await deleteBinary(s.fake.runner, output);
    expect(s.fake.files.has(PATH)).toBe(false);
  });
});

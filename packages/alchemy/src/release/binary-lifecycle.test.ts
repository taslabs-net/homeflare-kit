/**
 * The install lifecycle over a fake host (launchd/fake-runner.ts) and a fake transport — no network,
 * no real filesystem: what an install writes, what a matching host costs (nothing), and read and
 * delete. Every refusal: binary-refusals.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { sha256Hex } from '../launchd/job-form.ts';
import { deleteBinary, readBinary } from './binary-lifecycle.ts';
import { PATH, setup, writes } from './fake-install.ts';
import { BINARY, ENTERPRISE_URL, VMUTILS_URL, bytesOf, pathsOn } from './fake-release.ts';

describe('installing', () => {
  test('the declared member, from the plain archive only, verified, at <directory>/<name>', async () => {
    const s = setup();
    const notes: string[] = [];
    const attrs = await s.install(s.props(), { note: async (m: string) => void notes.push(m) });
    // ⛔ The enterprise sibling was served too, under its real name; it was never asked for.
    expect(s.transport.requests).toEqual([VMUTILS_URL]);
    expect(s.transport.requests).not.toContain(ENTERPRISE_URL);
    expect(s.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
    expect(attrs).toMatchObject({
      member: 'vmalert-prod',
      mode: 0o755,
      path: PATH,
      url: VMUTILS_URL,
    });
    expect(attrs.sha256).toBe(sha256Hex(BINARY.vmalert));
    expect(notes[0]).toContain('downloading');
  });

  test('⛔ an undeclared member is never written: vmagent-prod and vmauth-prod stay in the archive', async () => {
    const s = setup();
    await s.install();
    expect(pathsOn(s.fake)).toEqual([PATH]);
    expect(writes(s.fake).map((c) => c[1])).toEqual([PATH]);
  });

  test('already installed and matching: no download, no write', async () => {
    const s = setup();
    const output = await s.install();
    s.transport.requests.length = 0;
    s.fake.calls.length = 0;
    await s.install(s.props(), { olds: s.props(), output });
    expect([s.transport.requests, writes(s.fake)]).toEqual([[], []]);
  });

  test('the right bytes with the wrong mode: re-written from disk, not downloaded', async () => {
    const s = setup();
    const output = await s.install();
    s.transport.requests.length = 0;
    const fixed = await s.install(s.props({ mode: 0o555 }), { olds: s.props(), output });
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
    await s.install(s.props(), { output: old });
    expect(s.fake.files.has(old.path)).toBe(false);
    expect(s.fake.files.has(PATH)).toBe(true);
  });
});

describe('read and delete', () => {
  test('read reports the file at the path by its digest; delete removes it, twice', async () => {
    const s = setup();
    expect(await readBinary(s.fake.runner, s.props())).toBeUndefined();
    const output = await s.install();
    expect((await readBinary(s.fake.runner, s.props()))?.sha256).toBe(output.sha256);
    await deleteBinary(s.fake.runner, output);
    await deleteBinary(s.fake.runner, output);
    expect(s.fake.files.has(PATH)).toBe(false);
  });
});

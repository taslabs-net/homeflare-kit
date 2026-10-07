import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { publishedContents } from '../scripts/published-tarball.ts';
import { contentsOfTarball } from '../scripts/tarball-contents.ts';
import {
  aliasesOntoWorkspace,
  isPublished,
  needsWorkspaceCopy,
} from '../scripts/unpublished-siblings.ts';

const workspace = new Map([
  ['@homeflare/distilled-netbox', '/repo/packages/distilled-netbox/'],
  ['@homeflare/distilled-proxmox', '/repo/packages/distilled-proxmox/'],
]);

describe('aliasesOntoWorkspace', () => {
  test('finds aliases onto workspace packages, and nothing else', () => {
    const manifest = {
      dependencies: {
        '@distilled.cloud/netbox': 'npm:@homeflare/distilled-netbox@0.3.0',
        '@distilled.cloud/forgejo': 'npm:@someone-else/forgejo@1.0.0',
        effect: '4.0.0-rc.115',
      },
      peerDependencies: { '@distilled.cloud/proxmox': 'npm:@homeflare/distilled-proxmox@0.2.0' },
    };
    expect(aliasesOntoWorkspace(manifest, workspace)).toEqual([
      {
        field: 'dependencies',
        name: '@distilled.cloud/netbox',
        target: '@homeflare/distilled-netbox',
        version: '0.3.0',
      },
      {
        field: 'peerDependencies',
        name: '@distilled.cloud/proxmox',
        target: '@homeflare/distilled-proxmox',
        version: '0.2.0',
      },
    ]);
  });

  test('a manifest with no aliases needs nothing', () => {
    expect(aliasesOntoWorkspace({ dependencies: { effect: '4.0.0-rc.115' } }, workspace)).toEqual(
      [],
    );
  });
});

describe('isPublished', () => {
  const answering = (status: number, seen: string[] = []) =>
    (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(null, { status });
    }) as unknown as typeof fetch;

  test('200 is published, and a scoped name is encoded the way npm wants', async () => {
    const seen: string[] = [];
    expect(await isPublished('@homeflare/distilled-netbox', '0.2.0', answering(200, seen))).toBe(
      true,
    );
    expect(seen).toEqual(['https://registry.npmjs.org/@homeflare%2fdistilled-netbox/0.2.0']);
  });

  test('404 is not published', async () => {
    expect(await isPublished('@homeflare/distilled-netbox', '0.3.0', answering(404))).toBe(false);
  });

  test('a registry outage fails loudly instead of reading as unpublished', async () => {
    await expect(
      isPublished('@homeflare/distilled-netbox', '0.3.0', answering(503)),
    ).rejects.toThrow(/answered 503/);
  });
});

/** A real tarball of `files` (path under `package/` to text), packed the way npm lays one out. */
async function tarballOf(dir: string, name: string, files: Record<string, string>) {
  await mkdir(join(dir, name, 'package'), { recursive: true });
  for (const [path, text] of Object.entries(files)) {
    // oxlint-disable-next-line no-await-in-loop
    await Bun.write(join(dir, name, 'package', path), text);
  }
  const out = join(dir, `${name}.tgz`);
  const tar = Bun.spawn(['tar', '-czf', out, '-C', join(dir, name), 'package']);
  expect(await tar.exited).toBe(0);
  return out;
}

describe('needsWorkspaceCopy, over real tarballs', () => {
  const base = (over: Record<string, string> = {}) => ({
    'package.json': JSON.stringify({
      name: 'sib',
      version: '0.2.0',
      exports: { '.': './dist/index.js' },
      dependencies: { '@distilled.cloud/core': '1.0.0-rc.13' },
    }),
    'dist/index.js': 'export const a = 1;\n',
    'dist/index.d.ts': 'export declare const a: number;\n',
    ...over,
  });
  const manifest = (over: Record<string, unknown>) =>
    JSON.stringify({ ...JSON.parse(base()['package.json']), ...over });

  let dir = '';
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'siblings-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const differs = async (change: Record<string, string>) =>
    needsWorkspaceCopy(
      await contentsOfTarball(await tarballOf(dir, 'published', base())),
      await contentsOfTarball(await tarballOf(dir, 'packed', base(change))),
    );

  test('an unpublished version always comes from the workspace', async () => {
    const packed = await contentsOfTarball(await tarballOf(dir, 'packed', base()));
    expect(needsWorkspaceCopy(null, packed)).toBe(true);
  });

  test('identical files install from npm, whatever the manifest key order', async () => {
    const reordered = JSON.stringify({
      dependencies: { '@distilled.cloud/core': '1.0.0-rc.13' },
      exports: { '.': './dist/index.js' },
      version: '0.2.0',
      name: 'sib',
    });
    expect(await differs({})).toBe(false);
    expect(await differs({ 'package.json': reordered })).toBe(false);
  });

  test('a source-only change comes from the workspace', async () => {
    expect(await differs({ 'dist/index.js': 'export const a = 2;\n' })).toBe(true);
  });

  test('a declarations-only change comes from the workspace', async () => {
    expect(await differs({ 'dist/index.d.ts': 'export declare const a: string;\n' })).toBe(true);
  });

  test('an exports-only change comes from the workspace', async () => {
    const exports = { '.': './dist/other.js' };
    expect(await differs({ 'package.json': manifest({ exports }) })).toBe(true);
  });

  test('a changed dependency comes from the workspace', async () => {
    const deps = { '@distilled.cloud/core': '1.0.0-rc.14' };
    expect(await differs({ 'package.json': manifest({ dependencies: deps }) })).toBe(true);
  });

  test('an added or removed file comes from the workspace', async () => {
    expect(await differs({ 'dist/extra.js': 'export {};\n' })).toBe(true);
  });
});

describe('publishedContents', () => {
  const reply = (status: number, body?: unknown) =>
    (async () =>
      new Response(body === undefined ? null : JSON.stringify(body), {
        status,
      })) as unknown as typeof fetch;

  test('404 is null, and an outage fails loudly instead of reading as unpublished', async () => {
    expect(await publishedContents('a', '1', reply(404))).toBeNull();
    await expect(publishedContents('a', '1', reply(503))).rejects.toThrow(/answered 503/);
  });

  test('a manifest with no tarball url fails', async () => {
    await expect(publishedContents('a', '1', reply(200, { name: 'a' }))).rejects.toThrow(
      /lists no tarball/,
    );
  });

  test('a tarball download that fails throws', async () => {
    const calls = [
      new Response(JSON.stringify({ dist: { tarball: 'https://x/a.tgz' } })),
      new Response(null, { status: 502 }),
    ];
    const fetchImpl = (async () => calls.shift()) as unknown as typeof fetch;
    await expect(publishedContents('a', '1', fetchImpl)).rejects.toThrow(/tarball answered 502/);
  });

  test('the downloaded tarball is read by content', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'siblings-test-'));
    try {
      const tgz = await tarballOf(dir, 'pub', { 'package.json': '{}', 'a.js': 'x' });
      const bytes = await Bun.file(tgz).arrayBuffer();
      const calls = [
        new Response(JSON.stringify({ dist: { tarball: 'https://x/a.tgz' } })),
        new Response(bytes),
      ];
      const fetchImpl = (async () => calls.shift()) as unknown as typeof fetch;
      const got = await publishedContents('a', '1', fetchImpl);
      expect([...(got ?? new Map()).keys()].sort()).toEqual([
        'package/a.js',
        'package/package.json',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

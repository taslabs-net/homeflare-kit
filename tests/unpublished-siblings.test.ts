import { describe, expect, test } from 'bun:test';
import { aliasesOntoWorkspace, isPublished } from '../scripts/unpublished-siblings.ts';

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

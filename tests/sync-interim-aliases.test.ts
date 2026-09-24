import { describe, expect, test } from 'bun:test';
import { aliasChanges, applyChanges } from '../scripts/sync-interim-aliases.ts';

const versions = new Map([
  ['@homeflare/distilled-netbox', '0.3.0'],
  ['@homeflare/distilled-proxmox', '0.2.0'],
  ['@homeflare/alchemy', '0.27.4'],
]);

const manifest = `{
  "name": "@homeflare/alchemy",
  "dependencies": {
    "@distilled.cloud/netbox": "npm:@homeflare/distilled-netbox@0.2.0",
    "@distilled.cloud/proxmox": "npm:@homeflare/distilled-proxmox@0.2.0",
    "@distilled.cloud/forgejo": "npm:@someone-else/forgejo@1.0.0"
  },
  "devDependencies": { "alchemy": "2.0.0-beta.79" }
}
`;

describe('sync-interim-aliases', () => {
  test('moves an alias onto a bumped workspace package, and only that one', () => {
    const changes = aliasChanges(JSON.parse(manifest), versions);
    expect(changes).toEqual([
      {
        field: 'dependencies',
        name: '@distilled.cloud/netbox',
        target: '@homeflare/distilled-netbox',
        from: '0.2.0',
        to: '0.3.0',
      },
    ]);
  });

  test('rewrites the text in place, keeping every other byte', () => {
    const out = applyChanges(manifest, aliasChanges(JSON.parse(manifest), versions));
    expect(out).toBe(manifest.replace('distilled-netbox@0.2.0', 'distilled-netbox@0.3.0'));
  });

  test('an alias onto a package outside the workspace is left alone', () => {
    const only = `{"dependencies":{"x":"npm:@someone-else/forgejo@1.0.0"}}`;
    expect(aliasChanges(JSON.parse(only), versions)).toEqual([]);
  });

  test('a manifest already in step needs nothing', () => {
    const inStep = manifest.replace('distilled-netbox@0.2.0', 'distilled-netbox@0.3.0');
    expect(aliasChanges(JSON.parse(inStep), versions)).toEqual([]);
  });

  test('a file whose shape changed stops the release instead of guessing', () => {
    const change = aliasChanges(JSON.parse(manifest), versions);
    const reshaped = manifest.replace(
      '"@distilled.cloud/netbox": "npm:@homeflare/distilled-netbox@0.2.0"',
      '"@distilled.cloud/netbox":"npm:@homeflare/distilled-netbox@0.2.0"',
    );
    expect(() => applyChanges(reshaped, change)).toThrow(/expected one/);
  });
});

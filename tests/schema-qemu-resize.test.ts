/** The resize operation exists: packed module names are not an endpoint inventory. */
import { expect, test } from 'bun:test';
import { blockFor, endpoints } from '../codegen/types-endpoint.ts';
import { parseApidoc } from '../codegen/apidoc.ts';
import { present, readManifest, verifiedText } from '../codegen/schema-cache.ts';
import { formViolations } from '../packages/alchemy/src/proxmox/constraint-guard.ts';
import type { NodesNodeQemuVmidResizePutParams } from '../packages/alchemy/src/proxmox/generated/pve.ts';

const manifest = await readManifest();
const cachePresent = await present(manifest, ['pve-apidoc']);

test.skipIf(!cachePresent)(
  'the pinned vendor schema generates QEMU resize including disk/size',
  async () => {
    const all = endpoints(parseApidoc(await verifiedText(manifest, 'pve-apidoc')));
    const endpoint = all.find(
      (item) => item.method === 'PUT' && item.path === '/nodes/{node}/qemu/{vmid}/resize',
    );
    expect(endpoint).toBeDefined();
    if (endpoint === undefined) throw new Error('vendor resize operation missing');
    const block = blockFor(endpoint);
    expect(block.text).toContain("'scsi0'");
    expect(block.text).toContain('size: string');
    expect(block.text).toContain('NodesNodeQemuVmidResizePutReturn = string');
  },
);

test('resize forms enforce the generated vendor constraints', () => {
  const key = 'pve:PUT /nodes/{node}/qemu/{vmid}/resize';
  expect(formViolations(key, { disk: 'scsi0', size: '64G' }, true)).toEqual([]);
  for (const form of [
    { disk: 'scsi31', size: '64G' },
    { disk: 'scsi0', size: '-1G' },
    { disk: 'scsi0' },
  ]) {
    expect(formViolations(key, form, true).length).toBeGreaterThan(0);
  }
});

test('the generator emits the existing PVE QEMU resize request and task response', async () => {
  // PVE 9.2.11 shape recorded in the generated module; minimal parameter subset exercises
  // the generator without pretending the absent full schema cache was re-read.
  const block = blockFor({
    method: 'PUT',
    path: '/nodes/{node}/qemu/{vmid}/resize',
    info: {
      parameters: {
        properties: {
          node: { type: 'string' },
          vmid: { type: 'integer' },
          disk: { type: 'string', enum: ['scsi0'] },
          size: { type: 'string' },
        },
      },
      returns: { type: 'string' },
    },
  });
  expect(block.text).toContain('export type NodesNodeQemuVmidResizePutParams');
  expect(block.text).toContain('size: string');
  expect(block.text).toContain('export type NodesNodeQemuVmidResizePutReturn = string;');
  expect(block.text).not.toContain('vmid:');
  const request: NodesNodeQemuVmidResizePutParams = { disk: 'scsi0', size: '64G' };
  expect(request).toEqual({ disk: 'scsi0', size: '64G' });
  const generated = await Bun.file(
    new URL(
      '../packages/alchemy/src/proxmox/generated/pve/nodes-node-qemu-vmid-mtunnel.ts',
      import.meta.url,
    ),
  ).text();
  expect(generated).toContain('9.2.11/f6997e698c7933ea');
  expect(generated).toContain('PUT /nodes/{node}/qemu/{vmid}/resize');
});

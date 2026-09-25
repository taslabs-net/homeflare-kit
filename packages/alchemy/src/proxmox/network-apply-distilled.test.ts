/** NetworkApply over a stub. The interfaces diff must not enter state. */
import { expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxNetworkApply, ProxmoxNetworkApplyProvider } from './network-apply.ts';

const SECRET = 'wpa-psk-do-not-store';
const DIFF = `--- a/interfaces\n+++ b/interfaces\n@@ -1 +1 @@\n-old\n+${SECRET}\n`;
const UPID = 'UPID:pve1:00000001:0:0:srvreload:networking:test@pve!fake:';
const health = [
  { id: 'cluster', name: 'c1', type: 'cluster', quorate: 1 },
  { id: 'node/pve1', name: 'pve1', type: 'node', online: 1 },
];
const task = {
  exitstatus: 'OK',
  id: 'networking',
  node: 'pve1',
  pid: 1,
  pstart: 1,
  starttime: 1,
  status: 'stopped',
  type: 'srvreload',
  upid: UPID,
  user: 'test@pve',
};

const engine = (staged: { value: boolean }) => {
  const fake = fakePve((call) => {
    if (call.path.startsWith('cluster/status')) return health;
    if (call.path.includes('/tasks/')) return task;
    if (call.method === 'PUT') {
      staged.value = false;
      return UPID;
    }
    if (call.path.startsWith('nodes/pve1/network')) {
      return staged.value
        ? Response.json({
            changes: DIFF,
            data: [{ iface: 'vmbr0', type: 'bridge' }],
          })
        : [{ iface: 'vmbr0', type: 'bridge' }];
    }
    return null;
  });
  return {
    fake,
    stack: engineOver(ProxmoxNetworkApplyProvider().pipe(Layer.provideMerge(fake.layer))),
  };
};

const declare = () => ProxmoxNetworkApply('row', { node: 'pve1', target: FAKE_TARGET });

test('a settled node is adopted without a reload', async () => {
  const { fake, stack } = engine({ value: false });
  await withoutBao(async () => {
    expect(await stack.deploy(declare())).toEqual({ row: 'adopted' });
    expect((await stack.verify(declare(), { all: true })).rows[0]).toMatchObject({ diff: 'noop' });
  });
  expect(fake.writes()).toEqual([]);
});

test('a staged diff is applied once, then the secret is not in state', async () => {
  const staged = { value: true };
  const { fake, stack } = engine(staged);
  await withoutBao(async () => {
    expect((await stack.verify(declare(), { all: true })).rows[0]).toMatchObject({
      diff: 'update',
    });
    await stack.deploy(declare());
    expect(stack.stored()).not.toContain(SECRET);
    expect((await stack.verify(declare(), { all: true })).rows[0]).toMatchObject({ diff: 'noop' });
  });
  expect(fake.writes()).toEqual(['PUT nodes/pve1/network']);
  expect(fake.calls.some((call) => JSON.stringify(call).includes(SECRET))).toBe(false);
});

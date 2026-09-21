/**
 * When a container read counts as "absent" — the question that decides between adopt and create.
 *
 * ⛔ WHAT THESE PIN: only a 500 whose vmid the cluster does not list anywhere is absent, whatever
 *   the message says; a 403 or a 500 for a guest the cluster lists on the declared node FAILS the
 *   plan with PVE's own error; nothing is written in any case. resource.ts's fold of every error
 *   into "absent" is exactly what this resource must not inherit — under it, a lease without
 *   VM.Audit plans a CREATE over a running guest.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import { type FakePve, fakePve, writesOf } from './fake-pve-lxc.ts';
import { LIVE, TARGET, lxcEngine, seed } from './lxc-harness.ts';
import { ProxmoxLxc } from './lxc.ts';

const NODE = 'pve1';

let fake: FakePve | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});

const declared = (vmid: number) =>
  ProxmoxLxc('ct', {
    hostname: 'ct-example',
    node: NODE,
    ostemplate: 'local:vztmpl/t.tar.zst',
    target: TARGET,
    vmid,
  }).pipe(adopt(true));

describe('absent means the cluster does not list the vmid', () => {
  test('a 500 with no message, for a vmid nowhere in the cluster, plans a create', async () => {
    fake = fakePve();
    fake.configErrors.set(`${NODE}/150`, { body: { data: null }, status: 500 });
    const run = await lxcEngine(fake).plan(declared(150));
    expect(run).toMatchObject({ actions: { ct: 'create' }, failure: '' });
  });

  test('a 500 for a guest the cluster lists on this node fails with PVE’s error', async () => {
    fake = fakePve();
    seed(fake, NODE, 100, LIVE);
    const message = 'got timeout\n';
    fake.configErrors.set(`${NODE}/100`, { body: { data: null, message }, status: 500 });
    const run = await lxcEngine(fake).plan(declared(100));
    expect(run.failure).toContain('got timeout');
    expect(run.actions).toEqual({});
    expect(writesOf(fake)).toEqual([]);
  });

  test('a 403 is never absent: the plan fails instead of planning a create', async () => {
    fake = fakePve();
    const message = 'Permission check failed (/vms/150, VM.Audit)\n';
    fake.configErrors.set(`${NODE}/150`, { body: { data: null, message }, status: 403 });
    const run = await lxcEngine(fake).plan(declared(150));
    expect(run.failure).toContain('-> 403');
    expect(run.actions).toEqual({});
  });
});

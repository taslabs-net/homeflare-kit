/**
 * Whose guest it is — docs/ownership.md applied to `Proxmox.Lxc`, through the real engine over
 * fake-pve-lxc.ts (placeholders only).
 *
 * ⛔ WHAT THESE PIN: with no state, no live guest is adopted without `--adopt` or `adopt(true)`,
 *   not even one that matches the declaration; `adopt(false)` wins over the flag; a deploy that
 *   planned a create refuses a guest it then finds, and forgets its `creating` row; under
 *   `--adopt` it records a matching one with no write and still refuses one that differs; and a
 *   create interrupted after its POST resumes WITHOUT `--adopt` when the guest is what it wrote,
 *   and asks for `--adopt` when someone changed it meanwhile — which then adopts it only as it
 *   now runs, never writing the declaration back over the change (lxc-adoption.ts).
 * ★ THE INTERRUPTION IS A CREATE TASK THAT ENDS IN AN ERROR AFTER THE FAKE BUILT THE GUEST — to the
 *   engine the same as a deploy killed while it waited on the task: a live guest, and a
 *   `creating` row with no attributes.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import { type FakePve, fakePve, writesOf } from './fake-pve-lxc.ts';
import { KEY, NODE, TARGET, VMID, lxcEngine, pasted, seed } from './lxc-harness.ts';
import { ProxmoxLxc } from './lxc.ts';
import type { LxcProps } from './lxc-props.ts';

const TAKEOVER = 'already exists, and this stack holds no state for it';

let fake: FakePve | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});
const cluster = () => {
  fake = fakePve();
  return fake;
};
const live = () => {
  const pve = cluster();
  seed(pve, NODE, VMID);
  return pve;
};

describe('with no state, a live guest is never adopted silently', () => {
  test.each([
    ['one that matches', 'ct-example'],
    ['one that differs', 'somebody-else'],
  ])('%s: the plan fails "Cannot adopt" and nothing is written', async (_, hostname) => {
    const pve = live();
    const run = await lxcEngine(pve).deploy(
      ProxmoxLxc('ct', { hostname, node: NODE, target: TARGET, vmid: VMID }),
    );
    expect(run.failure).toContain('Cannot adopt');
    expect(writesOf(pve)).toEqual([]);
  });

  test('--adopt takes a matching guest over with no write; the next plan is noop', async () => {
    const pve = live();
    const stack = lxcEngine(pve);
    const run = await stack.deploy(ProxmoxLxc('ct', pasted()), { adopt: true });
    expect(run).toMatchObject({ actions: { ct: 'adopted' }, failure: '' });
    expect(writesOf(pve)).toEqual([]);
    expect((await stack.plan(ProxmoxLxc('ct', pasted()))).actions).toEqual({ ct: 'noop' });
  });

  test('adopt(false) wins over --adopt', async () => {
    const pve = live();
    const declared = ProxmoxLxc('ct', pasted()).pipe(adopt(false));
    const run = await lxcEngine(pve).deploy(declared, { adopt: true });
    expect(run.failure).toContain('Cannot adopt');
    expect(writesOf(pve)).toEqual([]);
  });
});

describe('a create never takes over a guest it finds at apply', () => {
  test('one that appears after the plan is refused, matching or not, and its row forgotten', async () => {
    const pve = live();
    pve.vanish.set(KEY, 2);
    const stack = lxcEngine(pve);
    expect((await stack.plan(ProxmoxLxc('ct', pasted()))).actions).toEqual({ ct: 'create' });
    const run = await stack.deploy(ProxmoxLxc('ct', pasted()));
    expect(run.failure).toContain(TAKEOVER);
    expect(writesOf(pve)).toEqual([]);
    expect(stack.status('ct')).toBeUndefined();
    expect((await stack.plan(ProxmoxLxc('ct', pasted()))).failure).toContain('Cannot adopt');
  });

  test('under --adopt, one that matches is recorded with no write', async () => {
    const pve = live();
    pve.vanish.set(KEY, 1);
    const stack = lxcEngine(pve);
    const run = await stack.deploy(ProxmoxLxc('ct', pasted()), { adopt: true });
    expect(run).toMatchObject({ actions: { ct: 'create' }, failure: '' });
    expect(writesOf(pve)).toEqual([]);
    expect((await stack.plan(ProxmoxLxc('ct', pasted()))).actions).toEqual({ ct: 'noop' });
  });

  test('under --adopt, one that differs is still refused until a plan can show it', async () => {
    const pve = live();
    pve.vanish.set(KEY, 2);
    const stack = lxcEngine(pve);
    const declared = () => ProxmoxLxc('ct', pasted({ memory: 1024 }));
    expect((await stack.plan(declared())).actions).toEqual({ ct: 'create' });
    const run = await stack.deploy(declared(), { adopt: true });
    expect(run.failure).toContain('already exists on pve1 and differs in memory');
    expect(writesOf(pve)).toEqual([]);
  });
});

describe('an interrupted create', () => {
  const door = (over: Partial<LxcProps> = {}) =>
    ProxmoxLxc('door', {
      hostname: 'door-example',
      node: NODE,
      ostemplate: 'local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst',
      rootfs: 'local-zfs:8',
      target: TARGET,
      vmid: 150,
      ...over,
    });
  const interrupted = async () => {
    const pve = cluster();
    const stack = lxcEngine(pve);
    pve.task.exit = 'interrupted';
    expect((await stack.deploy(door())).failure).toContain('ended "interrupted"');
    expect(stack.status('door')).toBe('creating');
    pve.task.exit = 'OK';
    return { pve, stack };
  };

  test('resumes without --adopt when the guest is what it wrote, and writes nothing more', async () => {
    const { pve, stack } = await interrupted();
    expect((await stack.deploy(door())).failure).toBe('');
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
    expect((await stack.plan(door())).actions).toEqual({ door: 'noop' });
  });

  test('resumes when the plan reads no guest and the apply then finds it (diff noted it)', async () => {
    const { pve, stack } = await interrupted();
    pve.vanish.set(`${NODE}/150`, 1);
    expect((await stack.deploy(door())).failure).toBe('');
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
    expect(stack.status('door')).toBe('created');
  });

  test('is our own guest, not an adoption: a declaration changed meanwhile is written', async () => {
    const { pve, stack } = await interrupted();
    const run = await stack.deploy(door({ hostname: 'door-renamed' }));
    expect(run.failure).toBe('');
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`, `PUT nodes/${NODE}/lxc/150/config`]);
    expect(pve.guests.get(`${NODE}/150`)?.['hostname']).toBe('door-renamed');
  });

  test('asks for --adopt when the guest changed meanwhile, and adopts it only as it runs', async () => {
    const { pve, stack } = await interrupted();
    const guest = pve.guests.get(`${NODE}/150`) ?? {};
    guest['hostname'] = 'someone-else';
    expect((await stack.deploy(door())).failure).toContain('Cannot resume creating');
    const refused = await stack.deploy(door(), { adopt: true });
    expect(refused.failure).toContain('adopting it would change hostname');
    expect(refused.failure).not.toContain('someone-else');
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
    const resumed = await stack.deploy(door({ hostname: 'someone-else' }), { adopt: true });
    expect(resumed.failure).toBe('');
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
    expect(pve.guests.get(`${NODE}/150`)?.['hostname']).toBe('someone-else');
  });
});

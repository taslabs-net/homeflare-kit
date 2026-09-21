/**
 * The guards an adversarial review found untested or missing, through the real engine over
 * fake-pve-lxc.ts: each test here failed against a mutant of the guard it names (2026-09-21).
 *
 * ⛔ WHAT THESE PIN: a guest the cluster lost is named at plan before a deploy rebuilds it; a task
 *   that fails, or answers no UPID, is a failed deploy; a write PVE accepted but did not store is
 *   caught by the read-back; a new template is refused; an options change on a volume that also
 *   grows keeps the live size in the PUT and resizes after it; and a vmid PVE spells as a string
 *   is still "listed". Whose guest it is: lxc-ownership.test.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import { type FakePve, fakePve, writesOf } from './fake-pve-lxc.ts';
import { LIVE, TARGET, lxcEngine, seed } from './lxc-harness.ts';
import { ProxmoxLxc } from './lxc.ts';
import type { LxcProps } from './lxc-props.ts';

const NODE = 'pve1';
const VMID = 100;
const KEY = `${NODE}/${String(VMID)}`;
const TEMPLATE = 'local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst';

const pasted = (over: Partial<LxcProps> = {}): LxcProps => {
  const { lxc: _raw, ...config } = LIVE;
  return { ...(config as Partial<LxcProps>), node: NODE, target: TARGET, vmid: VMID, ...over };
};

let fake: FakePve | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});
const cluster = () => {
  fake = fakePve();
  return fake;
};

describe('a guest the cluster no longer lists, with state still held', () => {
  test('with a template: the plan warns it will be created again, and the deploy does', async () => {
    const pve = cluster();
    seed(pve, NODE, VMID);
    const stack = lxcEngine(pve);
    // ⚠️ Without the devices (a token cannot create passthrough), and with the NEW-disk
    //   spellings, which compare equal to the live volumes but can only allocate fresh ones.
    const rebuildable = pasted({
      dev0: undefined,
      dev1: undefined,
      mp0: 'tank:200,mp=/data',
      ostemplate: TEMPLATE,
      rootfs: 'local-zfs:40',
    });
    const declared = () => ProxmoxLxc('ct', rebuildable).pipe(adopt(true));
    expect((await stack.deploy(declared())).failure).toBe('');
    pve.guests.delete(KEY);
    const planned = await stack.plan(declared());
    expect(planned.actions).toEqual({ ct: 'update' });
    expect(planned.warnings.join('\n')).toContain('CREATES it again from ostemplate');
    expect((await stack.deploy(declared())).failure).toBe('');
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
  });

  test('declared by live volume ids: refused, never a template unpacked onto them', async () => {
    const pve = cluster();
    seed(pve, NODE, VMID);
    const stack = lxcEngine(pve);
    const declared = () =>
      ProxmoxLxc('ct', pasted({ dev0: undefined, dev1: undefined, ostemplate: TEMPLATE })).pipe(
        adopt(true),
      );
    expect((await stack.deploy(declared())).failure).toBe('');
    pve.guests.delete(KEY);
    const run = await stack.deploy(declared());
    expect(run.failure).toContain('rootfs: local-zfs:subvol-100-disk-0,size=40G names an existing');
    expect(run.failure).toContain('mp0: tank:subvol-100-disk-0');
    expect(writesOf(pve)).toEqual([]);
  });

  test('without one: the plan fails, rather than planning an update the deploy cannot make', async () => {
    const pve = cluster();
    seed(pve, NODE, VMID);
    const stack = lxcEngine(pve);
    expect((await stack.deploy(ProxmoxLxc('ct', pasted()).pipe(adopt(true)))).failure).toBe('');
    pve.guests.delete(KEY);
    expect((await stack.plan(ProxmoxLxc('ct', pasted()))).failure).toContain(
      'nothing to create it from',
    );
  });
});

describe('a write is claimed only when PVE says it finished', () => {
  const door = () =>
    ProxmoxLxc('door', {
      node: NODE,
      ostemplate: TEMPLATE,
      rootfs: 'local-zfs:8',
      target: TARGET,
      vmid: 150,
    });

  test('a create task that ends in an error fails the deploy, naming the task', async () => {
    const pve = cluster();
    pve.task.exit = 'unable to create CT 150 - command failed';
    const run = await lxcEngine(pve).deploy(door());
    expect(run.failure).toContain('ended "unable to create CT 150 - command failed"');
  });

  test('a create answered with no UPID fails the deploy', async () => {
    const pve = cluster();
    pve.task.noUpid = true;
    expect((await lxcEngine(pve).deploy(door())).failure).toContain('returned no task id');
  });

  test('a config write PVE accepted but did not store fails the read-back', async () => {
    const pve = cluster();
    seed(pve, NODE, VMID);
    pve.ignore.add('memory');
    const run = await lxcEngine(pve).deploy(
      ProxmoxLxc('ct', pasted({ memory: 4096 })).pipe(adopt(true)),
    );
    expect(run.failure).toContain('memory still differ');
  });
});

describe('identity and volumes', () => {
  test('another template for a guest that exists is refused at plan', async () => {
    const pve = cluster();
    seed(pve, NODE, VMID);
    const stack = lxcEngine(pve);
    await stack.deploy(ProxmoxLxc('ct', pasted({ ostemplate: TEMPLATE })).pipe(adopt(true)));
    const run = await stack.plan(
      ProxmoxLxc('ct', pasted({ ostemplate: 'local:vztmpl/other.tar.zst' })),
    );
    expect(run.failure).toContain('a template is consumed at create');
    expect(writesOf(pve)).toEqual([]);
  });

  test('options and growth on one volume: the PUT keeps the live size, the resize follows', async () => {
    const pve = cluster();
    seed(pve, NODE, VMID);
    const mp0 = 'tank:subvol-100-disk-0,mp=/data,backup=1,size=300G';
    const run = await lxcEngine(pve).deploy(ProxmoxLxc('ct', pasted({ mp0 })).pipe(adopt(true)));
    expect(run.failure).toBe('');
    const path = `nodes/${NODE}/lxc/${String(VMID)}`;
    expect(writesOf(pve)).toEqual([`PUT ${path}/config`, `PUT ${path}/resize`]);
    const put = pve.seen.find((call) => call.path.endsWith('/config') && call.method === 'PUT');
    expect(put?.form.get('mp0')).toBe('tank:subvol-100-disk-0,mp=/data,backup=1,size=200G');
    expect(pve.guests.get(KEY)?.['mp0']).toContain('size=300G');
  });

  test('a vmid the cluster spells as a string is still listed, never absent', async () => {
    const pve = cluster();
    pve.others.push({ node: 'pve2', type: 'qemu', vmid: '101' });
    const run = await lxcEngine(pve).plan(
      ProxmoxLxc('ct', pasted({ ostemplate: TEMPLATE, vmid: 101 })),
    );
    expect(run.failure).toContain('vmid 101 is a qemu on pve2');
  });
});

/**
 * Declaring a NEW container, and removing one, through the real engine over fake-pve-lxc.ts.
 *
 * ⛔ WHAT THESE PIN: a create POSTs once, waits for its task, reads back what PVE allocated and
 *   then plans `noop` against it; a create an API token cannot finish (no template, device
 *   passthrough, a bind mount) fails before any write; dropping the declaration retains the guest;
 *   and only `RemovalPolicy.destroy()` sends the DELETE.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { type FakePve, fakePve, writesOf } from './fake-pve-lxc.ts';
import { TARGET, lxcEngine } from './lxc-harness.ts';
import { ProxmoxLxc } from './lxc.ts';
import type { LxcProps } from './lxc-props.ts';

const NODE = 'pve1';
const VMID = 150;

const door = (over: Partial<LxcProps> = {}): LxcProps => ({
  cores: 1,
  features: 'nesting=1',
  hostname: 'door-example',
  memory: 512,
  net0: 'name=eth0,bridge=vmbr0,ip=192.0.2.20/24,gw=192.0.2.1',
  node: NODE,
  onboot: 1,
  ostemplate: 'local:vztmpl/debian-13-standard_13.1-2_amd64.tar.zst',
  rootfs: 'local-zfs:8',
  start: 1,
  tags: 'Vault;door',
  target: TARGET,
  vmid: VMID,
  ...over,
});

let fake: FakePve | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});
const empty = () => {
  fake = fakePve();
  return fake;
};

describe('creating a container', () => {
  test('one POST, then the next plan is noop against what PVE allocated', async () => {
    const pve = empty();
    const stack = lxcEngine(pve);
    const created = await stack.deploy(ProxmoxLxc('door', door()));
    expect(created.actions).toEqual({ door: 'create' });
    expect(created.failure).toBe('');
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
    const post = pve.seen.find((call) => call.method === 'POST')?.form;
    expect(post?.get('rootfs')).toBe('local-zfs:8');
    expect(post?.get('start')).toBe('1');
    expect(post?.get('password')).toBeNull();
    const live = pve.guests.get(`${NODE}/${String(VMID)}`);
    expect(live?.['rootfs']).toBe(`local-zfs:subvol-${String(VMID)}-disk-0,size=8G`);
    expect(live?.['net0']).toContain('hwaddr=');
    expect((await stack.plan(ProxmoxLxc('door', door()))).actions).toEqual({ door: 'noop' });
  });

  test.each([
    ['no template', { ostemplate: '' }, /nothing to create it from/],
    ['device passthrough', { dev0: '/dev/net/tun' }, /pct set 150 --dev0/],
    ['a bind mount', { mp0: '/srv/share,mp=/share' }, /bind or device mount point/],
    ['a feature beyond nesting', { features: 'nesting=1,keyctl=1' }, /other than nesting/],
  ])('refused before any write: %s', async (_, over, reason) => {
    const pve = empty();
    const run = await lxcEngine(pve).deploy(ProxmoxLxc('door', door(over as Partial<LxcProps>)));
    expect(run.failure).toMatch(reason);
    expect(writesOf(pve)).toEqual([]);
  });
});

describe('removing a container', () => {
  test('retain is the default: dropping the declaration sends no DELETE', async () => {
    const pve = empty();
    const stack = lxcEngine(pve);
    await stack.deploy(ProxmoxLxc('door', door()));
    expect((await stack.deploy(Effect.void)).failure).toBe('');
    expect(stack.status('door')).toBeUndefined();
    expect(pve.guests.has(`${NODE}/${String(VMID)}`)).toBe(true);
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
  });

  test('RemovalPolicy.destroy() reaches the DELETE, and waits for its task', async () => {
    const pve = empty();
    const stack = lxcEngine(pve);
    await stack.deploy(ProxmoxLxc('door', door()).pipe(RemovalPolicy.destroy()));
    expect((await stack.deploy(Effect.void)).failure).toBe('');
    expect(pve.guests.has(`${NODE}/${String(VMID)}`)).toBe(false);
    expect(writesOf(pve)).toEqual([
      `POST nodes/${NODE}/lxc`,
      `DELETE nodes/${NODE}/lxc/${String(VMID)}`,
    ]);
    // PVE APIServer/AnyEvent.pm uri_unescape runs before routing; the SDK encodes labels.
    expect(
      pve.seen.some((call) => /\/tasks\/UPID:.*vzdestroy/.test(decodeURIComponent(call.path))),
    ).toBe(true);
    // ⛔ No `force` (stops a running guest), `purge` (drops it from HA and backup jobs) or
    //   `destroy-unreferenced-disks` (deletes volumes the config does not even name).
    const del = pve.seen.find((call) => call.method === 'DELETE');
    expect(del?.form.toString()).toBe('');
  });

  test('destroy() refuses a guest that no longer matches: the vmid may be somebody else’s', async () => {
    const pve = empty();
    const stack = lxcEngine(pve);
    await stack.deploy(ProxmoxLxc('door', door()).pipe(RemovalPolicy.destroy()));
    const live = pve.guests.get(`${NODE}/${String(VMID)}`) ?? {};
    live['hostname'] = 'someone-else';
    const run = await stack.deploy(Effect.void);
    expect(run.failure).toContain('no longer matches its last declaration (hostname)');
    expect(pve.guests.has(`${NODE}/${String(VMID)}`)).toBe(true);
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
  });

  test('a changed vmid is refused, never a second guest', async () => {
    const pve = empty();
    const stack = lxcEngine(pve);
    await stack.deploy(ProxmoxLxc('door', door()));
    const run = await stack.plan(ProxmoxLxc('door', door({ vmid: VMID + 1 })));
    expect(run.failure).toContain('is a different guest');
    expect(writesOf(pve)).toEqual([`POST nodes/${NODE}/lxc`]);
  });
});

/**
 * AN ADOPTION NEVER CHANGES A GUEST (lxc-adoption.ts), through Alchemy's real plan and apply over
 * fake-pve-lxc.ts (placeholders only).
 *
 * ⛔ WHAT THESE PIN: a cold adoption that differs from the live guest in ANY key fails the plan —
 *   under `adopt(true)` and under `--adopt` alike — naming the keys and none of the values, before
 *   `judge`'s own refusals (which print a declared value); nothing is written and no row is left.
 *   A hand edit between the plan and the deploy is refused at apply with nothing written; the
 *   adoption row it leaves keeps refusing until the declaration says what is live, and then adopts
 *   with no write. An interrupted create that `--adopt` resumes is held to the same rule:
 *   lxc-ownership.test.ts.
 * ★ MUTATION-CHECKED 2026-09-21: removing either `refuseAdoptedDrift` call in lxc.ts, or any one of
 *   the three adoption answers in ownership/adopting.ts, fails a test here or in
 *   lxc-ownership.test.ts.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import { type FakePve, fakePve, writesOf } from './fake-pve-lxc.ts';
import { KEY, NODE, VMID, lxcEngine, pasted, seed } from './lxc-harness.ts';
import { ProxmoxLxc } from './lxc.ts';
import type { LxcProps } from './lxc-props.ts';

const REFUSAL = 'adopting it would change';

let fake: FakePve | undefined;
afterEach(() => {
  fake?.stop();
  fake = undefined;
});
const live = () => {
  fake = fakePve();
  seed(fake, NODE, VMID);
  return fake;
};

const drifted = (): LxcProps =>
  pasted({ memory: 4096, net1: 'name=eth1,bridge=vmbr1,ip=198.51.100.4/24,mtu=9000' });

describe('a cold adoption that differs from the live guest fails the plan', () => {
  test.each([
    ['adopt(true)', () => ProxmoxLxc('ct', drifted()).pipe(adopt(true)), {}],
    ['--adopt', () => ProxmoxLxc('ct', drifted()), { adopt: true }],
  ])('under %s: keys named, values never, nothing written', async (_, declare, options) => {
    const pve = live();
    const stack = lxcEngine(pve);
    const planned = await stack.plan(declare(), options);
    expect(planned.failure).toContain(`CT ${String(VMID)} on ${NODE}: ${REFUSAL} memory, net1.`);
    for (const value of ['4096', '8192', '9000', '1500']) {
      expect(planned.failure).not.toContain(value);
    }
    const deployed = await stack.deploy(declare(), options);
    expect(deployed.failure).toContain(`${REFUSAL} memory, net1`);
    expect(writesOf(pve)).toEqual([]);
    expect(stack.status('ct')).toBeUndefined();
  });

  test.each([
    ['a device passthrough', { dev1: '/dev/fuse' }, 'dev1', ['/dev/fuse', 'pct set']],
    ['an unprivileged flip', { unprivileged: 0 as const }, 'unprivileged', ['live 1']],
    [
      'a smaller mount point',
      { mp0: 'tank:subvol-900-disk-0,mp=/data,size=100G' },
      'mp0',
      ['100G'],
    ],
  ])('%s is the adoption refusal, not the update one', async (_, change, key, hidden) => {
    const pve = live();
    const run = await lxcEngine(pve).plan(ProxmoxLxc('ct', pasted(change)).pipe(adopt(true)));
    expect(run.failure).toContain(`${REFUSAL} ${key}.`);
    for (const value of hidden) expect(run.failure).not.toContain(value);
    expect(writesOf(pve)).toEqual([]);
  });

  test('an exact match still adopts, with no write and no warning', async () => {
    const pve = live();
    const run = await lxcEngine(pve).deploy(ProxmoxLxc('ct', pasted()).pipe(adopt(true)));
    expect(run).toEqual({ actions: { ct: 'adopted' }, failure: '', warnings: [] });
    expect(writesOf(pve)).toEqual([]);
  });
});

describe('a hand edit between the plan and the deploy', () => {
  test('is refused at apply, and the adoption holds until the declaration says what is live', async () => {
    const pve = live();
    const stack = lxcEngine(pve);
    const declare = (over: Partial<LxcProps> = {}) =>
      ProxmoxLxc('ct', pasted(over)).pipe(adopt(true));
    // ★ Two config reads plan a cold adoption — the probe's and diff's — so the edit lands after
    //   the plan said `adopted` and before reconcile reads.
    pve.edits.set(KEY, { after: 2, set: { memory: 4096 } });
    const raced = await stack.deploy(declare());
    expect(raced.failure).toContain(`${REFUSAL} memory.`);
    expect(raced.failure).not.toContain('4096');
    expect(writesOf(pve)).toEqual([]);
    expect(pve.guests.get(KEY)?.['memory']).toBe(4096);
    expect(stack.status('ct')).toBe('updating');
    expect((await stack.plan(declare())).failure).toContain(`${REFUSAL} memory.`);
    const caughtUp = await stack.deploy(declare({ memory: 4096 }));
    expect(caughtUp.failure).toBe('');
    expect(writesOf(pve)).toEqual([]);
    expect(stack.status('ct')).toBe('updated');
    expect((await stack.plan(declare({ memory: 4096 }))).actions).toEqual({ ct: 'noop' });
  });
});

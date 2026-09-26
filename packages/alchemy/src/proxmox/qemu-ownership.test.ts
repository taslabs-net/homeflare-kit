/**
 * Whose VM it is — docs/ownership.md applied to `Proxmox.Vm` (red-team C2 on PR 297), through the
 * real engine over a stub fetch (fake-pve.ts).
 *
 * ⛔ WHAT THIS PINS: a live VM this stack holds no state for is never adopted or written silently
 *   (the measured regression: `adopt(false)` on an existing VM still planned `adopted` and PUT it).
 *   `adopt(false)` on the declaration wins over the test harness's own forced `AdoptPolicy: true`
 *   (fake-engine.ts) — a resource-scoped `adopt(...)` overrides the ambient policy both ways
 *   (ownership/adopt.ts), which is what lets this test observe the refusal at all.
 */
import { describe, expect, test } from 'bun:test';
import { adopt } from 'alchemy/AdoptPolicy';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxVm, ProxmoxVmProvider } from './qemu.ts';

const NODE = 'pve1';
const VMID = 150;
const props = { node: NODE, target: FAKE_TARGET, vmid: VMID };
const live = { digest: 'a'.repeat(40), memory: '512' };

const engine = (fake: ReturnType<typeof fakePve>) =>
  engineOver(ProxmoxVmProvider().pipe(Layer.provideMerge(fake.layer)));

describe('Proxmox.Vm ownership', () => {
  test('adopt(false): a live VM with no state is refused, and nothing is written', async () => {
    const fake = fakePve((call) => (call.method === 'GET' ? live : null));
    await withoutBao(async () => {
      await expect(engine(fake).deploy(ProxmoxVm('row', props).pipe(adopt(false)))).rejects.toThrow(
        /adopt|exists, and this stack holds no state/i,
      );
    });
    expect(fake.writes()).toEqual([]);
  });

  test('the harness default (adoption on) still adopts with no write — unchanged behaviour', async () => {
    const fake = fakePve((call) => (call.method === 'GET' ? live : null));
    await withoutBao(async () => {
      expect(await engine(fake).deploy(ProxmoxVm('row', props))).toEqual({ row: 'adopted' });
    });
    expect(fake.writes()).toEqual([]);
  });
});

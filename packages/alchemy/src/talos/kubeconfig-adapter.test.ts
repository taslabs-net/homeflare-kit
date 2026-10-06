/**
 * `Talos.Kubeconfig` diff against a row saved before the `talos-openbao` adapter existed.
 * Offline: fake-process.ts fakes `bao`/`talosctl`.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import type { FakeCall } from './fake-process.ts';
import { fixtureKubeconfig, props, run } from './kubeconfig.fixtures.ts';
import {
  type KubeconfigAttributes,
  diffKubeconfig as diff,
  reconcileKubeconfig as reconcile,
} from './kubeconfig.ts';

describe('diff — legacy rows', () => {
  it('plans update for a row saved with the dead placeholder connection', async () => {
    const output = await run(reconcile(props(), undefined), (call: FakeCall) => {
      if (call.command === 'bao' && call.args[1] === 'get') {
        return { stdout: JSON.stringify({ data: { data: { talosconfig: 'x' } } }) };
      }
      if (call.command === 'bao' && call.args[1] === 'put') return {};
      writeFileSync(call.args[1] ?? '', fixtureKubeconfig('old'));
      return {};
    });
    const old = {
      ...(output as KubeconfigAttributes),
      connection: { auth: { context: 'admin@hf-c1', kind: 'kubeconfig' } },
    } as unknown as KubeconfigAttributes;
    const result = await run(diff(props(), old), (call: FakeCall) =>
      call.args[1] === 'get'
        ? { stdout: JSON.stringify({ data: { data: { config: fixtureKubeconfig('old') } } }) }
        : {},
    );
    assert.equal(result?.action, 'update');
  });
});

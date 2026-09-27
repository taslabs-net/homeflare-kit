/**
 * `Talos.MachineConfig` acceptance tests from docs/plans/2026-09-26-talos-secrets-flow.md — fully
 * offline, fake `bao`/`talosctl` (fake-process.ts via machine-config-fixtures.ts), no real
 * process ever spawns. Bounded-poll-per-mode tests live in machine-config-poll.test.ts.
 */
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { describe, it } from 'node:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import {
  CONFIG_TEXT,
  PIN,
  dispatcher,
  hasTag,
  props,
  run,
  wrapperFor,
} from './machine-config-fixtures.ts';
import type { FakeCall } from './fake-process.ts';
import { diffMachineConfig, readMachineConfig } from './machine-config-read.ts';
import { type MachineConfigAttributes, reconcileMachineConfig } from './talos-machine-config.ts';
import { extractMachineConfigSpec } from './values.ts';

describe('reconcileMachineConfig — digest gate', () => {
  it('fails closed on a mismatch and never spawns talosctl', async () => {
    const calls: FakeCall[] = [];
    await assert.rejects(
      run(
        reconcileMachineConfig(props(), undefined),
        dispatcher({ configText: 'not the pinned text' }),
        calls,
      ),
      hasTag('TalosConfigDigestMismatch'),
    );
    assert.ok(
      calls.every((c) => c.command !== 'talosctl'),
      'no talosctl call on a digest mismatch',
    );
  });
});

describe('reconcileMachineConfig — apply argv and --insecure', () => {
  it('CREATE (output undefined) passes --insecure; argv never carries --dry-run', async () => {
    const calls: FakeCall[] = [];
    await run(reconcileMachineConfig(props(), undefined), dispatcher({}), calls);
    const apply = calls.find((c) => c.command === 'talosctl' && c.args[0] === 'apply-config');
    assert.ok(apply);
    assert.ok(apply.args.includes('--insecure'));
    assert.ok(!calls.some((c) => c.args.includes('--dry-run')));
  });

  it('UPDATE (output defined) never passes --insecure; base argv is exactly apply-config/--file/--mode', async () => {
    const calls: FakeCall[] = [];
    const output: MachineConfigAttributes = {
      configDigest: PIN,
      converged: 'read-back',
      mode: 'auto',
      node: props().node,
    };
    await run(reconcileMachineConfig(props(), output), dispatcher({}), calls);
    const apply = calls.find((c) => c.command === 'talosctl' && c.args[0] === 'apply-config');
    assert.ok(apply);
    assert.ok(!apply.args.includes('--insecure'));
    const filePath = apply.args[apply.args.indexOf('--file') + 1];
    assert.deepEqual(apply.args.slice(0, 5), [
      'apply-config',
      '--file',
      filePath,
      '--mode',
      'auto',
    ]);
  });

  it('the machine-config temp file exists (0600) exactly when talosctl spawns, and is gone after', async () => {
    let seenAtSpawn: { existed: boolean; mode: number } | undefined;
    let path = '';
    const handler = (call: FakeCall) => {
      if (call.command === 'talosctl' && call.args[0] === 'apply-config') {
        path = call.args[call.args.indexOf('--file') + 1] ?? '';
        seenAtSpawn = { existed: existsSync(path), mode: statSync(path).mode & 0o777 };
      }
      return dispatcher({})(call);
    };
    await run(reconcileMachineConfig(props(), undefined), handler);
    assert.ok(seenAtSpawn?.existed, 'temp file must exist the instant talosctl spawns');
    assert.equal(seenAtSpawn?.mode, 0o600);
    assert.equal(existsSync(path), false, 'temp file must be gone once reconcile returns');
  });
});

describe('readMachineConfig — extracted spec only, no swallowing', () => {
  it('converges even when wrapper metadata differs, since only spec is hashed', async () => {
    const result = await run(
      readMachineConfig(props()),
      dispatcher({ liveWrapper: () => ({ stdout: wrapperFor(CONFIG_TEXT, '999') }) }),
    );
    assert.ok(result);
    assert.equal(result.converged, 'read-back');
  });

  it('reports false (not an error), branded Unowned, when a successful read genuinely differs', async () => {
    const result = await run(
      readMachineConfig(props()),
      dispatcher({
        liveWrapper: () => ({ stdout: wrapperFor('machine:\n  type: controlplane\n') }),
      }),
    );
    assert.ok(result);
    assert.equal(result.converged, false);
    // ⛔ fix-first #1c — a digest mismatch on the engine's cold-start adoption probe must never
    //   read as plain (silently-owned) attrs, or a mistyped node pointing at a sibling row's
    //   configured node gets `apply-config` run onto it with no `adopt()` in sight.
    assert.equal(Unowned.is(result), true);
  });

  it('propagates the AUTHENTICATED failure when the maintenance probe also fails, never converged: false', async () => {
    await assert.rejects(
      run(
        readMachineConfig(props()),
        dispatcher({ liveWrapper: () => ({ exitCode: 1, stderr: 'unreachable' }) }),
      ),
      (error: unknown) => error instanceof Error && error.message.includes('unreachable'),
    );
  });
});

describe('readMachineConfig — cold-start adoption answer (fix-first #1)', () => {
  it('returns undefined (not created) when the authenticated read fails but the node answers insecurely', async () => {
    const result = await run(
      readMachineConfig(props()),
      dispatcher({
        liveWrapper: () => ({
          exitCode: 1,
          stderr: 'x509: certificate signed by unknown authority',
        }),
        maintenanceReachable: true,
      }),
    );
    assert.equal(result, undefined);
  });
});

describe('diffMachineConfig', () => {
  it('plans noop when the live digest matches, update when it does not', async () => {
    const output: MachineConfigAttributes = {
      configDigest: PIN,
      converged: 'read-back',
      mode: 'auto',
      node: props().node,
    };
    const noop = await run(diffMachineConfig(props(), output), dispatcher({}));
    assert.equal(noop?.action, 'noop');
    const update = await run(
      diffMachineConfig(props(), output),
      dispatcher({
        liveWrapper: () => ({ stdout: wrapperFor('machine:\n  type: controlplane\n') }),
      }),
    );
    assert.equal(update?.action, 'update');
  });

  it('plans update when the live resource is gone (node reverted to maintenance mode)', async () => {
    const output: MachineConfigAttributes = {
      configDigest: PIN,
      converged: 'read-back',
      mode: 'auto',
      node: props().node,
    };
    const result = await run(
      diffMachineConfig(props(), output),
      dispatcher({
        liveWrapper: () => ({
          exitCode: 1,
          stderr: 'x509: certificate signed by unknown authority',
        }),
        maintenanceReachable: true,
      }),
    );
    assert.equal(result?.action, 'update');
  });
});

// Sanity: the wrapper fixture itself round-trips through extractMachineConfigSpec (belt & suspenders
// with values.test.ts, which owns the exhaustive shape tests).
describe('fixture sanity', () => {
  it('wrapperFor embeds exactly CONFIG_TEXT under spec', () => {
    assert.equal(extractMachineConfigSpec(wrapperFor(CONFIG_TEXT)), CONFIG_TEXT);
  });
});

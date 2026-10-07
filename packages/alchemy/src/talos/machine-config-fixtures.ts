/**
 * Shared fixtures for talos-machine-config.test.ts and machine-config-poll.test.ts — split out
 * so neither test file needs to duplicate the fake `bao`/`talosctl` dispatcher (2026-09-26, K-A3).
 *
 * ⚠️ FIXTURES ONLY. `CONFIG_TEXT` is a plain marker string, never anything resembling a real
 *   Talos machine config, CA key or bootstrap token. No provider imports this file.
 */
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/process/ChildProcessSpawner';
import { type FakeCall, fakeSpawner } from './fake-process.ts';
import type { MachineConfigProps } from './talos-machine-config.ts';
import { configDigest } from './values.ts';

export const CONFIG_TEXT = 'machine:\n  type: worker\n';
export const PIN = configDigest(CONFIG_TEXT);
export const TARGET = { cluster: 'c1', mount: 'talos-c1' };
export const FAST_POLL = {
  immediate: { intervalMs: 0, maxAttempts: 3 },
  rebootish: { intervalMs: 0, maxAttempts: 4 },
};

export const props = (overrides: Partial<MachineConfigProps> = {}): MachineConfigProps => ({
  configDigest: PIN,
  configKey: 'nodes/10001',
  node: '198.51.100.10',
  target: TARGET,
  ...overrides,
});

/** Shape REASONED from talosctl's `get machineconfig -o yaml` — see values.ts's own header. */
export const wrapperFor = (specText: string, version = '1') =>
  `node: 198.51.100.10\nmetadata:\n  version: "${version}"\nspec: "${specText.replace(/\n/g, '\\n')}"\n`;

/** Routes fake `bao kv get` (config + talosconfig keys) and `talosctl` calls in one place. */
export const dispatcher = (opts: {
  configText?: string;
  liveWrapper?: () => { stdout?: string; exitCode?: number };
  applyExitCode?: number;
  /**
   * Controls the fix-first #1 maintenance-mode probe (`talosctl version --insecure`), reached only
   * when the authenticated `get machineconfig` above fails. Defaults to `false` so a bare failing
   * `liveWrapper` (most tests) still exercises the "both reads fail → propagate" path rather than
   * silently succeeding at the probe.
   */
  maintenanceReachable?: boolean;
}) => {
  const configText = opts.configText ?? CONFIG_TEXT;
  return (call: FakeCall) => {
    if (call.command === 'bao') {
      const key = call.args[3] ?? '';
      if (key.endsWith('/talosconfig')) {
        return {
          stdout: JSON.stringify({ data: { data: { talosconfig: 'fake-talosconfig-body' } } }),
        };
      }
      return { stdout: JSON.stringify({ data: { data: { config: configText } } }) };
    }
    if (call.command === 'talosctl') {
      if (call.args[0] === 'apply-config') return { exitCode: opts.applyExitCode ?? 0 };
      if (call.args[0] === 'version')
        return (opts.maintenanceReachable ?? false)
          ? { stdout: 'Client: v1.13.10\nServer: v1.13.10\n' }
          : { exitCode: 1, stderr: 'dial tcp: connection refused' };
      if (call.args[0] === 'get')
        return opts.liveWrapper?.() ?? { stdout: wrapperFor(CONFIG_TEXT) };
    }
    throw new Error(`dispatcher: unexpected call ${JSON.stringify(call)}`);
  };
};

export const run = <A, E>(
  effect: Effect.Effect<A, E, ChildProcessSpawner.ChildProcessSpawner>,
  handler: (c: FakeCall) => { stdout?: string; stderr?: string; exitCode?: number },
  calls: FakeCall[] = [],
) =>
  Effect.runPromise(
    Effect.provideService(
      effect,
      ChildProcessSpawner.ChildProcessSpawner,
      fakeSpawner(handler, calls),
    ),
  );

/** `Data.TaggedError` stamps `_tag`, not `.message` — see talos-errors.ts. */
export const hasTag = (tag: string) => (error: unknown) =>
  (error as { _tag?: string } | null)?._tag === tag;

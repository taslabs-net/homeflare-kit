/**
 * `Talos.Bootstrap` "once means once" — docs/plans/2026-09-26-talos-stack-first-boot.md's
 * acceptance test 4, K-talos-first-boot. Fully offline: fake-process.ts fakes `bao`/`talosctl`,
 * nothing real spawns.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Effect from 'effect/Effect';
import * as ChildProcessSpawner from 'effect/unstable/process/ChildProcessSpawner';
import { type FakeCall, fakeSpawner } from './fake-process.ts';
import {
  diffBootstrap as diff,
  readBootstrap as read,
  reconcileBootstrap as reconcile,
} from './talos-bootstrap.ts';

const TARGET = { cluster: 'c1', mount: 'talos-c1' };
const props = () => ({ node: '198.51.100.10', target: TARGET });

const bootstrapped = () => (call: FakeCall) => {
  if (call.command === 'bao')
    return { stdout: JSON.stringify({ data: { data: { talosconfig: 'x' } } }) };
  if (call.args[0] === 'get') return { stdout: '{"id":"member-1"}' };
  throw new Error(`unexpected call ${JSON.stringify(call)}`);
};

/** Absent until `bootstrap` is spawned, then present — models the CREATE path's before/after read. */
const notBootstrapped = () => {
  let ranBootstrap = false;
  return (call: FakeCall) => {
    if (call.command === 'bao')
      return { stdout: JSON.stringify({ data: { data: { talosconfig: 'x' } } }) };
    if (call.args[0] === 'bootstrap') {
      ranBootstrap = true;
      return {};
    }
    if (call.args[0] === 'get') return { stdout: ranBootstrap ? '{"id":"member-1"}' : '[]' };
    throw new Error(`unexpected call ${JSON.stringify(call)}`);
  };
};

const etcdReadFails = () => (call: FakeCall) => {
  if (call.command === 'bao')
    return { stdout: JSON.stringify({ data: { data: { talosconfig: 'x' } } }) };
  if (call.args[0] === 'get') return { exitCode: 1, stderr: 'dial tcp: connection refused' };
  throw new Error(`unexpected call ${JSON.stringify(call)}`);
};

const run = <A, E>(
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

describe('read — answers presence/absence, no swallowing', () => {
  it('returns undefined (absence) on a successful read with no members', async () => {
    const result = await run(read(props()), notBootstrapped());
    assert.equal(result, undefined);
  });

  it('returns attrs when members are present', async () => {
    const result = await run(read(props()), bootstrapped());
    assert.deepEqual(result, { bootstrapped: true, node: props().node });
  });

  it('propagates a transport failure instead of reporting absence', async () => {
    await assert.rejects(run(read(props()), etcdReadFails()));
  });
});

describe('diff — trusts state, never touches the live cluster once bootstrapped', () => {
  it('reports noop for output.bootstrapped=true WITHOUT any live call', async () => {
    const calls: FakeCall[] = [];
    const result = await run(
      diff(props(), { bootstrapped: true, node: props().node }),
      etcdReadFails(), // would reject if actually called
      calls,
    );
    assert.deepEqual(result, { action: 'noop' });
    assert.equal(calls.length, 0, 'diff must not call bao/talosctl once bootstrapped is true');
  });

  it('returns undefined (defer) when there is no prior output', async () => {
    const result = await run(diff(props(), undefined), bootstrapped());
    assert.equal(result, undefined);
  });
});

describe('reconcile — once means once (acceptance test 4)', () => {
  it('CREATE path (output undefined): bootstraps once when absent', async () => {
    const calls: FakeCall[] = [];
    const result = await run(reconcile(props(), undefined), notBootstrapped(), calls);
    assert.deepEqual(result, { bootstrapped: true, node: props().node });
    assert.equal(calls.filter((c) => c.args[0] === 'bootstrap').length, 1);
  });

  it('CREATE path: already bootstrapped (adopted) never spawns bootstrap', async () => {
    const calls: FakeCall[] = [];
    await run(reconcile(props(), undefined), bootstrapped(), calls);
    assert.ok(calls.every((c) => c.args[0] !== 'bootstrap'));
  });

  it('a failing confirmation read against bootstrapped state never spawns bootstrap, and refuses', async () => {
    const calls: FakeCall[] = [];
    await assert.rejects(
      run(reconcile(props(), { bootstrapped: true, node: props().node }), etcdReadFails(), calls),
      (error: unknown) => (error as { _tag?: string } | null)?._tag === 'TalosReBootstrapRefused',
    );
    assert.ok(
      calls.every((c) => c.args[0] !== 'bootstrap'),
      'never re-bootstrap on a failing read',
    );
  });

  it('an empty (successful) confirmation read against bootstrapped state never spawns bootstrap, and refuses', async () => {
    const calls: FakeCall[] = [];
    await assert.rejects(
      run(reconcile(props(), { bootstrapped: true, node: props().node }), notBootstrapped(), calls),
      (error: unknown) => (error as { _tag?: string } | null)?._tag === 'TalosReBootstrapRefused',
    );
    assert.ok(
      calls.every((c) => c.args[0] !== 'bootstrap'),
      'never re-bootstrap on an empty read',
    );
  });

  it('a successful confirmation read against bootstrapped state confirms without spawning bootstrap', async () => {
    const calls: FakeCall[] = [];
    const result = await run(
      reconcile(props(), { bootstrapped: true, node: props().node }),
      bootstrapped(),
      calls,
    );
    assert.deepEqual(result, { bootstrapped: true, node: props().node });
    assert.ok(calls.every((c) => c.args[0] !== 'bootstrap'));
  });
});

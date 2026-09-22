/**
 * `declareProvisionBaseline` through Alchemy's real plan and apply, over a fake PVE serving what the
 * generated bootstrap made (provision-cli-fake.ts `apiView`) — the proof that the two halves are
 * one baseline: after the bootstrap, the declaration adopts every object and writes NOTHING.
 * Also pinned: a hand edit shows up as a diff; every resource retains; `adopt` is piped only when
 * asked; and a refused name fails before anything is declared.
 */
import { describe, expect, test } from 'bun:test';
import { push } from 'alchemy';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxAclProvider } from './acl.ts';
import { FAKE_TARGET, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxGroupProvider } from './group.ts';
import { type CliState, apiView, freshCluster, runScript } from './provision-cli-fake.ts';
import { provisionBootstrap } from './provision-bootstrap.ts';
import { type DeclareProvisionOptions, declareProvisionBaseline } from './provision-declare.ts';
import { ProxmoxRoleProvider } from './role.ts';
import { ProxmoxUserProvider } from './user.ts';

const ALL = [
  'pve-role',
  'pve-mint-group',
  'pve-provision-user',
  'pve-read-user',
  'pve-provision-grant',
  'pve-read-grant',
];

const bootstrapped = async (): Promise<CliState> => {
  const run = await runScript(provisionBootstrap(), freshCluster());
  if (run.code !== 0) throw new Error(`bootstrap failed: ${run.stderr}`);
  return run.state;
};

const engineOn = (state: CliState) => {
  const live = apiView(state);
  const fake = fakePve((call) => (call.method === 'GET' ? live[call.path] : 'UPID:fake'));
  const providers = Layer.mergeAll(
    ProxmoxAclProvider(),
    ProxmoxGroupProvider(),
    ProxmoxRoleProvider(),
    ProxmoxUserProvider(),
  );
  return { engine: engineOver(providers.pipe(Layer.provideMerge(fake.layer))), fake };
};

describe('after the bootstrap, the declaration is a clean adoption', () => {
  test('every object is adopted, and nothing is written', async () => {
    const { engine, fake } = engineOn(await bootstrapped());
    await withoutBao(async () => {
      const report = await engine.verify(declareProvisionBaseline('pve', FAKE_TARGET));
      expect(report.rows.map((row) => [row.fqn, row.diff, row.ok])).toEqual(
        [...ALL].sort().map((fqn) => [fqn, 'noop', true]),
      );
      const deployed = await engine.deploy(declareProvisionBaseline('pve', FAKE_TARGET));
      expect(deployed).toEqual(Object.fromEntries(ALL.map((fqn) => [fqn, 'adopted'])));
    });
    expect(fake.writes()).toEqual([]);
  });

  test('a privilege added by hand is a diff on the role, and nothing else', async () => {
    const state = await bootstrapped();
    state.roles['HfProvisioner']?.push('VM.Console');
    const { engine } = engineOn(state);
    await withoutBao(async () => {
      const report = await engine.verify(declareProvisionBaseline('pve', FAKE_TARGET));
      const changed = report.rows.filter((row) => row.diff !== 'noop');
      expect(changed).toEqual([expect.objectContaining({ changed: ['privs'], fqn: 'pve-role' })]);
    });
  });
});

/** Register the declaration under a bare Stack and read back what Alchemy recorded per resource. */
const registered = async (options?: DeclareProvisionOptions) => {
  const spec = { actions: {}, bindings: {}, name: 'test', resources: {}, stage: 'test' };
  await Effect.runPromise(
    push('lab', declareProvisionBaseline('pve', FAKE_TARGET, {}, options)).pipe(
      Effect.provideService(Stack, spec as never),
    ) as Effect.Effect<unknown>,
  );
  return spec.resources as Record<string, { Adopt?: boolean; RemovalPolicy?: string }>;
};

describe('what the helper registers', () => {
  test('every resource retains, whatever the family default', async () => {
    const resources = await registered();
    expect(Object.keys(resources).sort()).toEqual(ALL.map((id) => `lab/${id}`).sort());
    for (const each of Object.values(resources)) expect(each.RemovalPolicy).toBe('retain');
  });

  test.each([
    [{ adopt: true }, true],
    [{ adopt: false }, false],
    [{}, undefined],
  ] as const)('adopt %o is recorded as %p on every resource', async (options, expected) => {
    for (const each of Object.values(await registered(options))) expect(each.Adopt).toBe(expected);
  });

  test('a refused name fails before anything is declared', async () => {
    const spec = { actions: {}, bindings: {}, name: 'test', resources: {}, stage: 'test' };
    const declared = declareProvisionBaseline('pve', FAKE_TARGET, { role: 'bad role' });
    const exit = await Effect.runPromiseExit(
      declared.pipe(Effect.provideService(Stack, spec as never)) as Effect.Effect<unknown, unknown>,
    );
    expect(String(exit)).toContain('role `bad role` is not a PVE role id');
    expect(spec.resources).toEqual({});
  });
});

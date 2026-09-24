/** Exact absence, state identity and deletion semantics through the real distilled protocol. */
import { expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import { engineOver } from '../verify/fake-engine.ts';
import { fakePve, withoutBao } from './fake-pve.ts';
import {
  aliasLive,
  aliasProps,
  replicationFirewallCases,
  replicationLive,
  replicationProps,
} from './replication-firewall-fixtures.ts';
import { ProxmoxFirewallAlias, ProxmoxFirewallAliasProvider } from './firewall-alias.ts';
import { ProxmoxReplicationJob, ProxmoxReplicationJobProvider } from './replication-job.ts';

for (const entry of replicationFirewallCases) {
  test(`${entry.name}: malformed successful reads never authorize a create`, async () => {
    for (const live of [null, {}, [], 'invalid', { ...entry.live, name: 'wrong', id: '901-0' }]) {
      const fake = fakePve(() => live);
      await withoutBao(async () => {
        expect(
          await Effect.runPromise(entry.read().pipe(Effect.flip, Effect.provide(fake.layer))),
        ).toMatchObject({ _tag: 'ProxmoxParseError', body: undefined });
        await expect(entry.engine(fake).deploy(entry.declare())).rejects.toBeDefined();
      });
      expect(fake.writes()).toEqual([]);
    }
  });

  test(`${entry.name}: only source-backed absence is folded`, async () => {
    const fake = fakePve(entry.missing);
    await withoutBao(async () => {
      expect(
        await Effect.runPromise(entry.read().pipe(Effect.provide(fake.layer))),
      ).toBeUndefined();
    });
    for (const [status, tag] of [
      [401, 'Unauthorized'],
      [403, 'Forbidden'],
      [500, 'InternalServerError'],
    ] as const) {
      const failed = fakePve(() =>
        Response.json({ data: null, message: 'unrelated failure' }, { status }),
      );
      await withoutBao(async () => {
        expect(
          await Effect.runPromise(entry.read().pipe(Effect.flip, Effect.provide(failed.layer))),
        ).toMatchObject({ _tag: tag });
        expect(
          await Effect.runPromise(entry.remove().pipe(Effect.flip, Effect.provide(failed.layer))),
        ).toMatchObject({ _tag: tag });
      });
    }
  });

  test(`${entry.name}: deletion succeeds when already absent`, async () => {
    const fake = fakePve(() =>
      entry.name === 'ReplicationJob'
        ? Response.json({ data: null, message: "no such job '900-0'\n" }, { status: 500 })
        : null,
    );
    await withoutBao(async () => {
      await Effect.runPromise(entry.remove().pipe(Effect.provide(fake.layer)));
    });
    expect(fake.writes()).toEqual([`DELETE ${entry.path}`]);
    expect(fake.calls[0]?.form).toEqual({});
  });

  test(`${entry.name}: explicit retain avoids DELETE, default destroy is implemented`, async () => {
    for (const retain of [true, false]) {
      const fake = fakePve((call) => (call.method === 'GET' ? entry.live : null));
      await withoutBao(async () => {
        const engine = entry.engine(fake);
        await engine.deploy(
          retain ? entry.declare().pipe(RemovalPolicy.retain()) : entry.declare(),
        );
        await engine.deploy(Effect.void);
      });
      expect(fake.writes()).toEqual(retain ? [] : [`DELETE ${entry.path}`]);
      expect(fake.calls.find((call) => call.method === 'DELETE')?.form ?? {}).toEqual({});
    }
  });
}

test('alias rename is create-first replacement; case-only rename remains no-op', async () => {
  const rows = new Map([['homelan', aliasLive]]);
  const fake = fakePve((call) => {
    const name = call.path.split('/').at(-1)?.toLowerCase() ?? '';
    if (call.method === 'GET')
      return (
        rows.get(name) ??
        Response.json(
          {
            data: null,
            message: 'Parameter verification failed.\n',
            errors: { name: 'no such alias' },
          },
          { status: 400 },
        )
      );
    if (call.method === 'POST') {
      const createdName = call.form['name'];
      if (createdName === undefined) throw new Error('alias create omitted its required name');
      rows.set(createdName.toLowerCase(), { ...aliasLive, name: createdName });
    }
    if (call.method === 'DELETE') rows.delete(name);
    return null;
  });
  await withoutBao(async () => {
    const engine = engineOver(ProxmoxFirewallAliasProvider().pipe(Layer.provideMerge(fake.layer)));
    await engine.deploy(ProxmoxFirewallAlias('row', aliasProps));
    await engine.deploy(ProxmoxFirewallAlias('row', { ...aliasProps, name: 'HOMELAN' }));
    expect(fake.writes()).toEqual([]);
    await engine.deploy(ProxmoxFirewallAlias('row', { ...aliasProps, name: 'NewLan' }));
  });
  expect(fake.writes()).toEqual([
    'POST cluster/firewall/aliases',
    'DELETE cluster/firewall/aliases/HomeLan',
  ]);
});

test('replication ignores migrated source/target and undeclared fractional rate', async () => {
  const fake = fakePve(() => ({
    ...replicationLive,
    target: 'pve-c',
    source: 'pve-b',
    rate: '10.5',
  }));
  await withoutBao(async () => {
    const engine = engineOver(ProxmoxReplicationJobProvider().pipe(Layer.provideMerge(fake.layer)));
    await engine.deploy(ProxmoxReplicationJob('row', replicationProps));
    expect(
      (
        await engine.verify(ProxmoxReplicationJob('row', { ...replicationProps, rate: 10.5 }), {
          all: true,
        })
      ).rows[0],
    ).toMatchObject({ diff: 'noop' });
  });
  expect(fake.writes()).toEqual([]);
});

test('vendor constraints reject invalid declarations before any write', async () => {
  for (const replication of [true, false]) {
    const fake = fakePve(() => (replication ? replicationLive : { ...aliasLive, name: 'x' }));
    await withoutBao(async () => {
      const engine = replication
        ? engineOver(ProxmoxReplicationJobProvider().pipe(Layer.provideMerge(fake.layer)))
        : engineOver(ProxmoxFirewallAliasProvider().pipe(Layer.provideMerge(fake.layer)));
      const declaration = replication
        ? ProxmoxReplicationJob('row', { ...replicationProps, rate: 0 })
        : ProxmoxFirewallAlias('row', { ...aliasProps, name: 'x' });
      await expect(engine.deploy(declaration)).rejects.toBeDefined();
    });
    expect(fake.writes()).toEqual([]);
  }
});

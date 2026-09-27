/** Real Alchemy Plan/Apply and distilled requests; fixtures never reach a real host. */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import { fakePve, withoutBao } from './fake-pve.ts';
import { replicationFirewallCases } from './replication-firewall-fixtures.ts';

for (const entry of replicationFirewallCases) {
  describe(`distilled ${entry.name}`, () => {
    test('adoption, subsequent plan and apply have zero writes', async () => {
      const fake = fakePve(() => entry.live);
      await withoutBao(async () => {
        const engine = entry.engine(fake);
        expect((await engine.verify(entry.declare(), { all: true })).rows).toEqual([
          expect.objectContaining({ diff: 'noop', ok: true }),
        ]);
        expect(await engine.deploy(entry.declare())).toEqual({ row: 'adopted' });
        expect((await engine.verify(entry.declare(), { all: true })).rows).toEqual([
          expect.objectContaining({ diff: 'noop', ok: true }),
        ]);
        await engine.deploy(entry.declare());
        expect(engine.stored()).not.toContain('fake-not-a-secret');
      });
      expect(fake.writes()).toEqual([]);
    });

    test('genuine absence creates once, then reads and converges', async () => {
      let exists = false;
      const fake = fakePve((call) => {
        if (call.method === 'GET') return exists ? entry.live : entry.missing();
        exists = true;
        return null;
      });
      await withoutBao(async () => {
        const engine = entry.engine(fake);
        await engine.deploy(entry.declare());
        expect((await engine.verify(entry.declare(), { all: true })).rows[0]).toMatchObject({
          diff: 'noop',
        });
      });
      expect(fake.writes()).toEqual([`POST ${entry.createPath}`]);
      expect(fake.calls.find((call) => call.method === 'POST')?.form).toEqual(entry.createForm);
    });

    test('live drift produces exactly one PUT and preserves omitted fields', async () => {
      let live = entry.drift;
      const fake = fakePve((call) => {
        if (call.method === 'GET') return live;
        live = entry.live;
        return null;
      });
      await withoutBao(async () => {
        const engine = entry.engine(fake);
        expect((await engine.verify(entry.declare(), { all: true })).rows[0]).toMatchObject({
          diff: 'update',
        });
        await engine.deploy(entry.declare());
        expect((await engine.verify(entry.declare(), { all: true })).rows[0]).toMatchObject({
          diff: 'noop',
        });
      });
      expect(fake.writes()).toEqual([`PUT ${entry.path}`]);
      const form = fake.calls.find((call) => call.method === 'PUT')?.form;
      if (entry.name === 'ReplicationJob') {
        expect(form).toEqual({ comment: '', disable: '0', schedule: '*/15', delete: 'remove_job' });
      } else {
        // PUT replaces the alias entry: omitted comment clears it, no delete/rename/id fields.
        expect(form).toEqual({ cidr: '192.0.2.1' });
      }
    });

    for (const status of [401, 403, 500]) {
      test(`${status} read failure stops cold adoption and confirmed drift before writes`, async () => {
        let fail = true;
        const fake = fakePve(() =>
          fail
            ? Response.json({ data: null, message: 'unrelated failure' }, { status })
            : entry.live,
        );
        await withoutBao(async () => {
          const engine = entry.engine(fake);
          await expect(engine.deploy(entry.declare())).rejects.toBeDefined();
          fail = false;
          await engine.deploy(entry.declare());
          fail = true;
          await expect(engine.drift(entry.declare())).rejects.toBeDefined();
          await expect(engine.deploy(entry.declare())).rejects.toBeDefined();
        });
        expect(fake.writes()).toEqual([]);
      });
    }

    test('delete failure retains the engine state and propagates', async () => {
      let failing = false;
      const fake = fakePve(() =>
        failing
          ? Response.json({ data: null, message: 'permission denied' }, { status: 403 })
          : entry.live,
      );
      await withoutBao(async () => {
        const engine = entry.engine(fake);
        await engine.deploy(entry.declare().pipe(RemovalPolicy.destroy()));
        failing = true;
        await expect(engine.deploy(Effect.void)).rejects.toBeDefined();
        expect(engine.stored()).toContain('row');
      });
    });
  });
}

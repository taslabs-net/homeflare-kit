/**
 * `Proxmox.Acl` through Alchemy's own Plan and Apply, over a fake cluster driving the REAL
 * `@distilled.cloud/proxmox` protocol (real path assembly, real form-urlencoded PUT body, real
 * `{"data": ...}` envelope) — the same harness `adopt-noop.test.ts` already runs this family
 * through (that file is the cross-family proof that an already-matching grant is read-only; this
 * one is the family's own write/delete/replace/read-back paths).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { ProxmoxAcl, ProxmoxAclProvider } from './acl.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';

type Row = { path: string; type: string; ugid: string; roleid: string; propagate?: number };

/** A cluster holding `rows`; a PUT mutates them the way PVE's own ACL handler does. */
const cluster = (rows: Row[]) =>
  fakePve((call: PveCall) => {
    if (call.method === 'GET' && call.path === 'access/acl') return rows;
    if (call.method !== 'PUT' || call.path !== 'access/acl') return undefined;
    const ugid = call.form['users'] ?? call.form['groups'] ?? call.form['tokens'];
    const type =
      call.form['users'] !== undefined
        ? 'user'
        : call.form['groups'] !== undefined
          ? 'group'
          : 'token';
    const idx = rows.findIndex(
      (r) => r.path === call.form['path'] && r.roleid === call.form['roles'] && r.ugid === ugid,
    );
    if (call.form['delete'] === '1') {
      if (idx !== -1) rows.splice(idx, 1);
      return undefined; // PVE answers {"data": null} on a successful PUT.
    }
    const row: Row = {
      path: call.form['path'] ?? '',
      propagate: call.form['propagate'] === '0' ? 0 : 1,
      roleid: call.form['roles'] ?? '',
      type,
      ugid: ugid ?? '',
    };
    if (idx === -1) rows.push(row);
    else rows[idx] = row;
    return undefined;
  });

const grant = (roleid = 'PVEAuditor') =>
  ProxmoxAcl('auditor', { path: '/', roleid, target: FAKE_TARGET, type: 'user', ugid: 'u@pve' });

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(ProxmoxAclProvider().pipe(Layer.provideMerge(fake.layer)));

describe('Proxmox.Acl over the distilled protocol', () => {
  test('creating a grant that does not exist yet: one PUT, propagate defaults on', async () => {
    const fake = cluster([]);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      // ⚠️ 'adopted', not 'created' — `diff` answers `undefined` when there is no prior state
      //   (there is no create verb for this family to plan one for; see the file header), so
      //   Alchemy reports the same label an adoption gets. `reconcile` still PUTs it below.
      expect(await engine.deploy(grant())).toEqual({ auditor: 'adopted' });
    });
    expect(fake.writes()).toEqual(['PUT access/acl']);
    const [call] = fake.calls.filter((c) => c.method === 'PUT');
    expect(call?.form).toMatchObject({
      path: '/',
      propagate: '1',
      roles: 'PVEAuditor',
      users: 'u@pve',
    });
  });

  test('a drifted propagate is corrected with exactly one PUT', async () => {
    const fake = cluster([
      { path: '/', propagate: 0, roleid: 'PVEAuditor', type: 'user', ugid: 'u@pve' },
    ]);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(grant());
      expect(report.rows[0]).toMatchObject({ diff: 'update' });
      expect(await engine.deploy(grant())).toEqual({ auditor: 'adopted' });
    });
    expect(fake.writes()).toEqual(['PUT access/acl']);
    const [putCall] = fake.calls.filter((c) => c.method === 'PUT');
    expect(putCall?.form['propagate']).toBe('1');
  });

  test('orphaning: the delete PUT carries delete=1, no propagate field, and removes the row', async () => {
    const fake = cluster([]);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(grant());
      expect(await engine.deploy(Effect.void)).toEqual({});
    });
    const [, deleteCall] = fake.calls.filter((c) => c.method === 'PUT');
    expect(deleteCall?.form).toMatchObject({
      delete: '1',
      path: '/',
      roles: 'PVEAuditor',
      users: 'u@pve',
    });
    expect(deleteCall?.form['propagate']).toBeUndefined();
    expect(fake.calls.filter((c) => c.method === 'GET').at(-1)).toBeDefined();
  });

  test('an identity change (roleid) replaces: the old grant is gone, the new one is bound', async () => {
    const fake = cluster([]);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(grant('PVEAuditor'));
      // ⚠️ `{ all: true }` — this row already has state, and `verify` reports only stateless
      //   rows by default (verify.ts's `VerifyOptions.all`).
      const report = await engine.verify(grant('PVEAdmin'), { all: true });
      expect(report.rows[0]).toMatchObject({ diff: 'replace' });
      await engine.deploy(grant('PVEAdmin'));
      // The live cluster now holds only the new grant — a fresh adopt of it plans noop.
      const after = await engine.verify(grant('PVEAdmin'), { all: true });
      expect(after.rows[0]).toMatchObject({ diff: 'noop' });
    });
    // Create-first (Alchemy's default): the new grant is PUT before the old one is removed.
    const puts = fake.calls.filter((c) => c.method === 'PUT');
    expect(puts.length).toBeGreaterThanOrEqual(2);
    expect(puts.some((c) => c.form['roles'] === 'PVEAdmin' && c.form['delete'] === undefined)).toBe(
      true,
    );
    expect(puts.some((c) => c.form['roles'] === 'PVEAuditor' && c.form['delete'] === '1')).toBe(
      true,
    );
  });

  test('a PUT that silently no-ops is refused, not recorded as landed', async () => {
    // ⚠️ A cluster whose PUT never actually lands the row — the permission-filtered case the
    //   header describes: PVE answers 200 with no error, but the grant never appears on GET.
    const fake = fakePve((call) =>
      call.method === 'GET' && call.path === 'access/acl' ? [] : undefined,
    );
    await expect(
      withoutBao(async () => {
        const engine = engineFor(fake);
        await engine.deploy(grant());
      }),
    ).rejects.toThrow(/still not bound/);
  });
});

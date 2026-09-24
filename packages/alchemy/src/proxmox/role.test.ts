/**
 * `Proxmox.Role` through Alchemy's own Plan and Apply, over a fake cluster driving the REAL
 * `@distilled.cloud/proxmox` protocol — create, drift, and delete, reading via the LIST (not the
 * item) as role.ts's header explains. adopt-noop.test.ts is the cross-family "adopting a
 * matching object only reads" proof; this file is Role's own write paths.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxRole, ProxmoxRoleProvider } from './role.ts';

type Row = { roleid: string; privs: string | undefined };

/** `GET /access/roles` (list) and `POST`/`PUT`/`DELETE .../roles(/{roleid})`, one flat list. */
const cluster = (rows: Row[]) =>
  fakePve((call: PveCall) => {
    if (call.method === 'GET' && call.path === 'access/roles') return rows;
    const match = /^access\/roles(?:\/(.+))?$/.exec(call.path);
    if (match === null) return undefined;
    const roleid = match[1];
    if (call.method === 'POST' && roleid === undefined) {
      rows.push({ privs: call.form['privs'], roleid: call.form['roleid'] ?? '' });
      return undefined;
    }
    if (call.method === 'PUT' && roleid !== undefined) {
      const idx = rows.findIndex((r) => r.roleid === roleid);
      if (idx !== -1) rows[idx] = { privs: call.form['privs'], roleid };
      return undefined;
    }
    if (call.method === 'DELETE' && roleid !== undefined) {
      const idx = rows.findIndex((r) => r.roleid === roleid);
      if (idx !== -1) rows.splice(idx, 1);
      return undefined;
    }
    return undefined;
  });

const declare = (privs: string[]) =>
  ProxmoxRole('mint', { privs, roleid: 'MintTokens', target: FAKE_TARGET });

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(ProxmoxRoleProvider().pipe(Layer.provideMerge(fake.layer)));

describe('Proxmox.Role over the distilled protocol', () => {
  test('creating a role that does not exist yet: one POST, privileges sorted and joined', async () => {
    const rows: Row[] = [];
    const fake = cluster(rows);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      expect(await engine.deploy(declare(['User.Modify', 'Sys.Audit']))).toEqual({
        mint: 'create',
      });
    });
    expect(fake.writes()).toEqual(['POST access/roles']);
    expect(rows).toEqual([{ privs: 'Sys.Audit,User.Modify', roleid: 'MintTokens' }]);
  });

  test('a drifted privilege set is corrected with exactly one PUT, no append field', async () => {
    const rows: Row[] = [{ privs: 'Sys.Audit', roleid: 'MintTokens' }];
    const fake = cluster(rows);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const declared = () => declare(['Sys.Audit', 'User.Modify']);
      const report = await engine.verify(declared());
      expect(report.rows[0]).toMatchObject({ diff: 'update' });
      expect(await engine.deploy(declared())).toEqual({ mint: 'adopted' });
    });
    const put = fake.calls.find((call) => call.method === 'PUT');
    expect(put?.form['privs']).toBe('Sys.Audit,User.Modify');
    expect(put?.pairs.some(([name]) => name === 'append')).toBe(false);
    expect(rows).toEqual([{ privs: 'Sys.Audit,User.Modify', roleid: 'MintTokens' }]);
  });

  // ⚠️ A role does not protect itself the way `destroy` in resource.ts describes for other
  //   objects (role.ts's own ⛔) — deleting one always sends the DELETE.
  test('deleting a role sends the DELETE', async () => {
    const rows: Row[] = [{ privs: 'Sys.Audit', roleid: 'MintTokens' }];
    const fake = cluster(rows);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(declare(['Sys.Audit']));
      expect(await engine.deploy(Effect.void)).toEqual({});
    });
    expect(fake.writes()).toEqual(['DELETE access/roles/MintTokens']);
    expect(rows).toEqual([]);
  });
});

/**
 * `Proxmox.Group` through Alchemy's own Plan and Apply, over a fake cluster driving the REAL
 * `@distilled.cloud/proxmox` protocol — the family's own create/drift/retain/destroy paths;
 * adopt-noop.test.ts owns the cross-family "adopting a matching object only reads" proof.
 */
import { describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxGroup, ProxmoxGroupProvider } from './group.ts';

type Live = { comment: string | undefined; members: string[] };

/** `access/groups` (POST) and `access/groups/{groupid}` (GET/PUT/DELETE), keyed by groupid. */
const cluster = (groups: Map<string, Live>) =>
  fakePve((call: PveCall) => {
    const match = /^access\/groups(?:\/(.+))?$/.exec(call.path);
    if (match === null) return undefined;
    const groupid = match[1];
    if (call.method === 'GET' && groupid !== undefined) return groups.get(groupid);
    if (call.method === 'POST' && groupid === undefined) {
      groups.set(call.form['groupid'] ?? '', { comment: call.form['comment'], members: [] });
      return undefined;
    }
    if (call.method === 'PUT' && groupid !== undefined) {
      const live = groups.get(groupid);
      if (live !== undefined) groups.set(groupid, { ...live, comment: call.form['comment'] });
      return undefined;
    }
    if (call.method === 'DELETE' && groupid !== undefined) {
      groups.delete(groupid);
      return undefined;
    }
    return undefined;
  });

const declare = (comment?: string) =>
  ProxmoxGroup('mint', {
    groupid: 'hf-mint',
    target: FAKE_TARGET,
    ...(comment === undefined ? {} : { comment }),
  });

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(ProxmoxGroupProvider().pipe(Layer.provideMerge(fake.layer)));

describe('Proxmox.Group over the distilled protocol', () => {
  test('creating a group that does not exist yet: one POST', async () => {
    const groups = new Map<string, Live>();
    const fake = cluster(groups);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      expect(await engine.deploy(declare('fence'))).toEqual({ mint: 'create' });
    });
    expect(fake.writes()).toEqual(['POST access/groups']);
    expect(groups.get('hf-mint')).toEqual({ comment: 'fence', members: [] });
  });

  test('a drifted comment is corrected with exactly one PUT', async () => {
    const groups = new Map<string, Live>([['hf-mint', { comment: 'old', members: [] }]]);
    const fake = cluster(groups);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(declare('fence'));
      expect(report.rows[0]).toMatchObject({ diff: 'update' });
      expect(await engine.deploy(declare('fence'))).toEqual({ mint: 'adopted' });
    });
    expect(fake.writes()).toEqual(['PUT access/groups/hf-mint']);
    expect(groups.get('hf-mint')?.comment).toBe('fence');
  });

  // ⛔ PVE cannot store the literal comment '0' (group.ts's header) — a declared '0' must read
  //   back as noop against a live '' rather than diffing forever.
  test("a declared comment of '0' matches a live empty comment (PVE's own truthiness trap)", async () => {
    const groups = new Map<string, Live>([['hf-mint', { comment: '', members: [] }]]);
    const fake = cluster(groups);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(declare('0'));
      expect(report.rows[0]).toMatchObject({ diff: 'noop' });
    });
    expect(fake.writes()).toEqual([]);
  });

  test('undeclaring sends no DELETE (retain is the default)', async () => {
    const groups = new Map<string, Live>();
    const fake = cluster(groups);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(declare('fence'));
      expect(await engine.deploy(Effect.void)).toEqual({});
    });
    expect(fake.writes()).toEqual(['POST access/groups']);
    expect(groups.has('hf-mint')).toBe(true);
  });

  test('RemovalPolicy.destroy() sends the DELETE', async () => {
    const groups = new Map<string, Live>();
    const fake = cluster(groups);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(declare('fence').pipe(RemovalPolicy.destroy()));
      expect(await engine.deploy(Effect.void)).toEqual({});
    });
    expect(fake.writes()).toEqual(['POST access/groups', 'DELETE access/groups/hf-mint']);
    expect(groups.has('hf-mint')).toBe(false);
  });
});

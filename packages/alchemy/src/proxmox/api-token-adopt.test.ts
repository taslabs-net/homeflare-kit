/**
 * `Proxmox.ApiToken` adopted, undeclared and drifted through Alchemy's own Plan and Apply, over a
 * fake cluster — pinning the metadata-only shape decision 9 (2026-09-23) builds: adopt and manage
 * `comment`/`expire`/`privsep`, never mint a token this resource cannot hand anybody the secret
 * for (api-token.ts's header).
 *
 * ★ FOUR LIVE SHAPES, MEASURED SHAPES FROM api-token.ts's OWN HEADER: `metrics@pve!exporter` (no
 *   comment), `iac@pve!apply` (commented), and a real non-zero `expire` offered as BOTH a JSON
 *   number and a JSON string — PVE returns either depending on path, and `int()` (values.ts) must
 *   not care which.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import { type ApiTokenProps, ProxmoxApiToken, ProxmoxApiTokenProvider } from './api-token.ts';
import { shape } from './api-token-form.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';
import type {
  AccessUsersUseridTokenTokenidPostParams,
  AccessUsersUseridTokenTokenidPutParams,
} from './generated/pve.ts';

type Live = { comment?: string; expire: number | string; privsep: number };

/** `access/users/{userid}/token/{tokenid}`, mutable so the PUT test can watch it change. */
const tokens = new Map<string, Live>([
  ['access/users/metrics@pve/token/exporter', { expire: 0, privsep: 0 }],
  ['access/users/iac@pve/token/apply', { comment: 'automation', expire: 0, privsep: 0 }],
  ['access/users/hf-read@pve/token/lease1', { expire: 1789327175, privsep: 0 }],
  ['access/users/hf-read@pve/token/lease2', { comment: 'lease', expire: '1789327175', privsep: 0 }],
]);

const cluster = () =>
  fakePve((call: PveCall) => {
    if (call.method === 'GET') return tokens.get(call.path);
    if (call.method === 'PUT') {
      const live = tokens.get(call.path);
      if (live !== undefined) tokens.set(call.path, { ...live, ...call.form });
      return call.form;
    }
    return undefined;
  });

/** The declared props matching a live fixture exactly — `expire` always as a `number` prop. */
const propsFor = (
  userid: string,
  tokenid: string,
  over: { comment?: string; privsep?: boolean },
): ApiTokenProps => ({
  expire: Number(tokens.get(`access/users/${userid}/token/${tokenid}`)?.expire ?? 0),
  privsep: over.privsep ?? false,
  target: FAKE_TARGET,
  tokenid,
  userid,
  ...(over.comment === undefined ? {} : { comment: over.comment }),
});

const token = (userid: string, tokenid: string, over: { comment?: string; privsep?: boolean }) =>
  ProxmoxApiToken(`${userid.replace('@', '-')}-${tokenid}`, propsFor(userid, tokenid, over));

const engineFor = (fake: ReturnType<typeof cluster>) =>
  engineOver(ProxmoxApiTokenProvider().pipe(Layer.provideMerge(fake.layer)));

const declared = () =>
  Effect.all([
    token('metrics@pve', 'exporter', {}),
    token('iac@pve', 'apply', { comment: 'automation' }),
    token('hf-read@pve', 'lease1', {}),
    token('hf-read@pve', 'lease2', { comment: 'lease' }),
  ]);

describe('adopting a metadata-only ApiToken declaration', () => {
  test('no comment, commented, and a real expire as both a number and a string: noop, adopted, no writes', async () => {
    const fake = cluster();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(declared());
      expect(report.rows).toHaveLength(4);
      for (const row of report.rows) {
        expect(row).toMatchObject({ changed: [], diff: 'noop', ok: true, planned: 'adopted' });
      }
      const planned = await engine.deploy(declared());
      expect(new Set(Object.values(planned))).toEqual(new Set(['adopted']));
      expect(Object.keys(planned)).toHaveLength(4);
    });
    expect(fake.writes()).toEqual([]);
  });

  test('undeclaring all four sends no DELETE (retain is the default)', async () => {
    const fake = cluster();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(declared());
      expect(await engine.deploy(Effect.void)).toEqual({});
    });
    expect(fake.writes()).toEqual([]);
  });

  test('an absent token: the deploy refuses with the mint-elsewhere message, and writes nothing', async () => {
    const fake = cluster();
    const gone = () =>
      ProxmoxApiToken('gone', {
        expire: 0,
        privsep: false,
        target: FAKE_TARGET,
        tokenid: 'missing',
        userid: 'nope@pve',
      });
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await expect(engine.deploy(gone())).rejects.toBeDefined();
    });
    expect(fake.writes()).toEqual([]);
  });

  test('a privsep flip: verify shows changed, and the deploy sends exactly one PUT of comment/expire/privsep', async () => {
    const fake = cluster();
    const flipped = () => token('iac@pve', 'apply', { comment: 'automation', privsep: true });
    await withoutBao(async () => {
      const engine = engineFor(fake);
      const report = await engine.verify(flipped());
      expect(report.rows[0]).toMatchObject({ changed: ['privsep'], diff: 'update', ok: false });
      expect(await engine.deploy(flipped())).toEqual({ 'iac-pve-apply': 'adopted' });
    });
    const put = fake.calls.find((call) => call.method === 'PUT');
    expect(fake.writes()).toEqual(['PUT access/users/iac@pve/token/apply']);
    expect(put?.pairs.map(([name]) => name)).toEqual(['comment', 'expire', 'privsep']);
  });

  test('the form keys typecheck against both generated PVE params, with no cast', () => {
    const props = propsFor('iac@pve', 'apply', { comment: 'automation' });
    const post: AccessUsersUseridTokenTokenidPostParams = shape(props);
    const put: AccessUsersUseridTokenTokenidPutParams = shape(props);
    expect(post).toEqual(put);
  });
});

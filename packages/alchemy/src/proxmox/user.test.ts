/**
 * `Proxmox.User` through Alchemy's own Plan and Apply, over a fake cluster driving the REAL
 * `@distilled.cloud/proxmox` protocol — create, drift (including the `groups` array/comma-string
 * asymmetry the header warns about), and delete. adopt-noop.test.ts (via Group) proves the
 * shared "adopting a matching object only reads" property; this file is User's own write paths.
 *
 * ⚠️ A MISSING USER IS A REAL 500, NOT `fakePve`'s USUAL 200-with-null. user.ts's own header
 *   measures this, and it matters here: `GetAccessUserResponse` has NO required field, so a
 *   200-with-`{}` (what `fakePve` always answers) decodes as a fully-present, all-default
 *   account rather than "absent" — the read would never fail and `create` would never trigger.
 *   `missingAs500` below is a small custom stub, not `fake-pve.ts`'s `fakePve`, for that reason.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, type PveCall, fakePve, withoutBao } from './fake-pve.ts';
import { ProxmoxUser, ProxmoxUserProvider, type UserProps } from './user.ts';

type Live = { comment: string; enable: string; expire: string; groups: readonly string[] };

/** `access/users` (POST) and `access/users/{userid}` (GET/PUT), a missing GET answering 500. */
const missingAs500 = (users: Map<string, Live>) => {
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    const path = url.pathname.replace(/^\/api2\/json\//, '');
    const match = /^access\/users(?:\/(.+))?$/.exec(path);
    if (match === null) return Response.json({ data: null });
    // ⚠️ distilled percent-encodes a `{userid}` label substitution (`iac@pve` -> `iac%40pve`,
    //   MEASURED) where client.ts's plain string concatenation never did. A real PVE decodes it
    //   like any HTTP server; this fake must too, or every userid with an `@` "vanishes".
    const userid = match[1] === undefined ? undefined : decodeURIComponent(match[1]);
    const params = new URLSearchParams(await request.text());
    const form = Object.fromEntries(params);
    if (request.method === 'GET' && userid !== undefined) {
      const live = users.get(userid);
      // ⚠️ THE TRAP THIS FILE EXISTS TO PROVE FIXED: measured PVE answers 500, not 200-null.
      if (live === undefined)
        return Response.json({ message: `no such user ('${userid}')` }, { status: 500 });
      return Response.json({ data: { ...live, groups: [...live.groups] } });
    }
    if (request.method === 'POST' && userid === undefined) {
      const { userid: id, ...rest } = form;
      if (id !== undefined) {
        users.set(id, {
          comment: rest['comment'] ?? '',
          enable: rest['enable'] ?? '1',
          expire: rest['expire'] ?? '0',
          groups:
            rest['groups'] === undefined || rest['groups'] === '' ? [] : rest['groups'].split(','),
        });
      }
      return Response.json({ data: null });
    }
    if (request.method === 'PUT' && userid !== undefined) {
      const live = users.get(userid);
      if (live !== undefined) {
        users.set(userid, {
          comment: form['comment'] ?? live.comment,
          enable: form['enable'] ?? live.enable,
          expire: form['expire'] ?? live.expire,
          groups:
            form['groups'] === undefined || form['groups'] === '' ? [] : form['groups'].split(','),
        });
      }
      return Response.json({ data: null });
    }
    if (request.method === 'DELETE' && userid !== undefined) {
      users.delete(userid);
      return Response.json({ data: null });
    }
    return Response.json({ data: null });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
  };
};

const declare = (over: Partial<UserProps> = {}): UserProps => ({
  target: FAKE_TARGET,
  userid: 'iac@pve',
  ...over,
});

describe('Proxmox.User over the distilled protocol', () => {
  test('creating an account that does not exist yet: one POST, defaults sent explicitly', async () => {
    const users = new Map<string, Live>();
    const fake = missingAs500(users);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxUserProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(ProxmoxUser('iac', declare()))).toEqual({ iac: 'create' });
    });
    expect(users.get('iac@pve')).toEqual({ comment: '', enable: '1', expire: '0', groups: [] });
  });

  test('a drifted comment settles, and an unsorted live groups array is not itself drift', async () => {
    const users = new Map<string, Live>([
      ['iac@pve', { comment: 'old', enable: '1', expire: '0', groups: ['b', 'a'] }],
    ]);
    const fake = missingAs500(users);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxUserProvider().pipe(Layer.provideMerge(fake.layer)));
      const declared = () => ProxmoxUser('iac', declare({ comment: 'new', groups: ['a', 'b'] }));
      const report = await engine.verify(declared());
      expect(report.rows[0]).toMatchObject({ changed: ['comment'], diff: 'update' });
      expect(await engine.deploy(declared())).toEqual({ iac: 'adopted' });
    });
    expect(users.get('iac@pve')).toMatchObject({ comment: 'new', groups: ['a', 'b'] });
  });

  test('deleting removes the account (no retain default for User)', async () => {
    const users = new Map<string, Live>([
      ['iac@pve', { comment: '', enable: '1', expire: '0', groups: [] }],
    ]);
    const fake = fakePve((call: PveCall) => {
      const match = /^access\/users\/(.+)$/.exec(call.path);
      if (match === null) return undefined;
      // ⚠️ decodeURIComponent — see the ⚠️ on `missingAs500` above: distilled percent-encodes it.
      const userid = decodeURIComponent(match[1] as string);
      if (call.method === 'GET') return users.get(userid);
      if (call.method === 'DELETE') users.delete(userid);
      return undefined;
    });
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxUserProvider().pipe(Layer.provideMerge(fake.layer)));
      await engine.deploy(ProxmoxUser('iac', declare()));
      expect(await engine.deploy(Effect.void)).toEqual({});
    });
    expect(users.has('iac@pve')).toBe(false);
    expect(fake.writes()).toEqual(['DELETE access/users/iac%40pve']);
  });
});

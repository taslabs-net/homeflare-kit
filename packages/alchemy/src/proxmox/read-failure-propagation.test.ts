/**
 * The 0.31.1 regression (measured live 2026-09-24, homeflare-proxmox `bun run plan`): every
 * `Proxmox.User`/`Proxmox.Group` row planned `update` with no warning, because their reads were
 * silently folding EVERY failure — not only a refused credential — into "absent". Two fixes,
 * both pinned here with REAL-SHAPED fixtures (live response bodies, nothing secret):
 *
 *  1. `access.getAccessUser`/`getAccessGroup` must be called with ONLY the schema's own label
 *     field, never the whole declared props object — the root cause: distilled's `buildRequest`
 *     treats every OTHER key as an "unknown key" and attaches it as a JSON body to what must stay
 *     a bodyless GET, which a stricter fetch client refuses outright.
 *  2. `diff` must never fold a genuine (non-credential-denial) read failure into "absent" — only
 *     `read`/`reconcile` may, where a wrongful fold costs at most a redundant, loudly-refused
 *     create, never a silent wrong write.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';
import { ProxmoxGroup, ProxmoxGroupProvider } from './group.ts';
import { ProxmoxUser, ProxmoxUserProvider } from './user.ts';

/**
 * A fake cluster whose GET on `path` answers 200 with `live`, but REFUSES (500, mimicking PVE's
 * real "InternalServerError" shape) once `transientFrom` is `true` — and asserts no request ever
 * carries a body on a GET, the request-shape regression's own signature.
 */
const clusterWithTransientFailure = (path: string, live: unknown) => {
  let transient = false;
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    if (request.method === 'GET') {
      const body = await request.text();
      // ⛔ THE REQUEST-SHAPE REGRESSION'S OWN SIGNATURE: a real fetch client refuses this outright.
      expect(body).toBe('');
    }
    // ⚠️ `decodeURIComponent` — user.ts's own ⚠️: distilled percent-encodes a `{userid}`/
    //   `{groupid}` label substitution (`tim@pve` -> `tim%40pve`), which a literal `path` compare
    //   would silently never match, turning every case below into a no-op stub.
    const wire = decodeURIComponent(url.pathname.replace(/^\/api2\/json\//, ''));
    if (wire !== path) return Response.json({ data: null });
    if (transient) {
      // MEASURED 2026-09-24, live TB4: a missing user/group answers exactly this shape.
      return Response.json({ data: null, message: `no such object (${path})` }, { status: 500 });
    }
    return Response.json({ data: live });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    breakReads: () => {
      transient = true;
    },
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
  };
};

describe('a transient read failure fails the plan loudly, never a silent false update', () => {
  test('Proxmox.User: diff() propagates a transient read failure once a state row exists', async () => {
    // MEASURED 2026-09-24, live TB4 `GET /access/users/tim@pve`.
    const live = {
      comment: 'Primary admin — PVE fallback',
      email: 'tim@schenanigans.com',
      enable: 1,
      expire: 0,
      firstname: 'Timothy',
      groups: ['Schenanigans'],
      lastname: 'Schneider',
      tokens: null,
    };
    const declare = () =>
      ProxmoxUser('tim', {
        comment: 'Primary admin — PVE fallback',
        email: 'tim@schenanigans.com',
        firstname: 'Timothy',
        groups: ['Schenanigans'],
        lastname: 'Schneider',
        target: FAKE_TARGET,
        userid: 'tim@pve',
      });
    const fake = clusterWithTransientFailure('access/users/tim@pve', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxUserProvider().pipe(Layer.provideMerge(fake.layer)));
      // First deploy: adopts the matching account, records a state row.
      expect(await engine.deploy(declare())).toEqual({ tim: 'adopted' });
      // Now every read of this account fails the way the live regression measured.
      fake.breakReads();
      // ⛔ THE FIX: this must REJECT (fail the plan), never resolve with a false 'update'.
      await expect(engine.verify(declare(), { all: true })).rejects.toBeDefined();
    });
  });

  test('Proxmox.Group: diff() propagates a transient read failure once a state row exists', async () => {
    // MEASURED 2026-09-24, live TB4 `GET /access/groups/HomeAssistant`.
    const live = { comment: 'Home Assistant service group', members: [] };
    const declare = () =>
      ProxmoxGroup('ha', {
        comment: 'Home Assistant service group',
        groupid: 'HomeAssistant',
        target: FAKE_TARGET,
      });
    const fake = clusterWithTransientFailure('access/groups/HomeAssistant', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxGroupProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ ha: 'adopted' });
      fake.breakReads();
      await expect(engine.verify(declare(), { all: true })).rejects.toBeDefined();
    });
  });

  // ★ A brand-new declaration's own create-from-a-500 path is already covered end to end by
  //   user.test.ts's `missingAs500` fixture — `readUser`/`readGroup` (used by `reconcile`) kept
  //   their fold on purpose, exactly so that path stays unaffected by this fix.
});

describe('the same fix, one command over: alchemy drift never reports a transient failure as missing', () => {
  // ⛔ FOUND BY ADVERSARIAL REVIEW OF THIS VERY FIX, 2026-09-24 — NOT part of the live-measured
  //   regression above, but the SAME bug class one layer deeper. `alchemy/src/Drift.ts` (`alchemy
  //   drift`/`sync`/`deploy --detect-drift`) calls a provider's `read` hook DIRECTLY on an
  //   already-confirmed row (`output: old.attr`, defined — Drift.ts:239-292), the same situation
  //   `diff` handles above. Before `user.ts`/`group.ts`'s `read` hook learned to branch on
  //   `output` (this fix's second half), it ALWAYS called the folding `readUser`/`readGroup` —
  //   so a transient failure here folded to `undefined`, and Drift.ts's own dry-run branch
  //   reports that as `{action: 'missing'}` with NO error surfaced at all: a silent false "this
  //   account is gone" report, worse than the false `update` `diff` used to produce because
  //   nothing here even logs a warning. `engineOver`'s new `drift` capability
  //   (verify/fake-engine.ts) drives the real `Alchemy.Drift.detect` over the same fake cluster.
  test('Proxmox.User: a confirmed row propagates instead of reporting missing', async () => {
    const live = {
      comment: 'Primary admin — PVE fallback',
      email: 'tim@schenanigans.com',
      enable: 1,
      expire: 0,
      firstname: 'Timothy',
      groups: ['Schenanigans'],
      lastname: 'Schneider',
      tokens: null,
    };
    const declare = () =>
      ProxmoxUser('tim', {
        comment: 'Primary admin — PVE fallback',
        email: 'tim@schenanigans.com',
        firstname: 'Timothy',
        groups: ['Schenanigans'],
        lastname: 'Schneider',
        target: FAKE_TARGET,
        userid: 'tim@pve',
      });
    const fake = clusterWithTransientFailure('access/users/tim@pve', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxUserProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ tim: 'adopted' });
      fake.breakReads();
      // ⛔ THE FIX: this must REJECT. Before `read`'s `output` branch, it resolved with
      //   `{ tim: { action: 'missing' } }` and no error anywhere.
      await expect(engine.drift(declare())).rejects.toBeDefined();
    });
  });

  test('Proxmox.Group: a confirmed row propagates instead of reporting missing', async () => {
    const live = { comment: 'Home Assistant service group', members: [] };
    const declare = () =>
      ProxmoxGroup('ha', {
        comment: 'Home Assistant service group',
        groupid: 'HomeAssistant',
        target: FAKE_TARGET,
      });
    const fake = clusterWithTransientFailure('access/groups/HomeAssistant', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxGroupProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ ha: 'adopted' });
      fake.breakReads();
      await expect(engine.drift(declare())).rejects.toBeDefined();
    });
  });
});

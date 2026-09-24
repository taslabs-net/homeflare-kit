/**
 * `Proxmox.Storage`'s own cries-wolf fix, PLUS the request-shape and transient-failure fixes
 * kit 0.31.2 (PR 239) found for User/Group — all three apply here for the first time on a
 * `provision`-role read, not a `read`-role one. Real-shaped fixtures (live TB4 response bodies,
 * measured 2026-09-24, nothing secret): `GET /storage/local` -> `{"data":{"storage":"local",
 * "type":"dir","content":"backup,vztmpl,iso","path":"/var/lib/vz","digest":"..."}}`, and a
 * missing storage -> `{"message":"storage '...' does not exist\n"}` at HTTP 500, the same shape
 * user.ts/group.ts measured for a missing user/group.
 */
import { describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';
import { ProxmoxStorage, ProxmoxStorageProvider } from './storage.ts';

/**
 * One storage row, an OpenBao mint the test can deny for `provision` mid-run (the cries-wolf
 * case), and a cluster answer the test can break into a transient 500 mid-run (the request-shape
 * regression's own case) — never both at once, so one fixture serves every test below.
 */
const clusterOverStorage = (id: string, live: Record<string, unknown>) => {
  let denyProvision = false;
  let transient = false;
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      if (denyProvision && url.pathname.endsWith('/creds/provision')) {
        return Response.json({ errors: ['permission denied'] }, { status: 403 });
      }
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    if (request.method === 'GET') {
      // ⛔ THE REQUEST-SHAPE REGRESSION'S OWN SIGNATURE (user.ts/group.ts): a real fetch client
      //   refuses a GET carrying a body outright.
      expect(await request.text()).toBe('');
    }
    const wire = decodeURIComponent(url.pathname.replace(/^\/api2\/json\//, ''));
    if (wire !== `storage/${id}`) return Response.json({ data: null });
    if (transient) {
      // MEASURED 2026-09-24, live TB4: a missing storage answers exactly this shape.
      return Response.json(
        { message: `storage '${id}' does not exist\n`, data: null },
        { status: 500 },
      );
    }
    return Response.json({ data: live });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    breakReads: () => {
      transient = true;
    },
    denyProvision: () => {
      denyProvision = true;
    },
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
  };
};

// MEASURED 2026-09-24, live TB4 `GET /storage/local`.
const live = { content: 'backup,vztmpl,iso', storage: 'local', type: 'dir' };
const declare = () =>
  ProxmoxStorage('local', {
    content: 'backup,vztmpl,iso',
    storage: 'local',
    target: FAKE_TARGET,
    type: 'dir',
  });

describe("Proxmox.Storage's own cries-wolf fix: a refused provision mint reports noop, never update", () => {
  test('an already-correct storage plans noop once the credential is denied, and nothing is written', async () => {
    const fake = clusterOverStorage('local', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxStorageProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ local: 'adopted' });
      fake.denyProvision();
      const report = await engine.verify(declare(), { all: true });
      // ⛔ THE BUG THIS PROVES FIXED — MEASURED live 2026-09-24: before this migration this row
      //   read `update` with nothing compared, the same as every other family before its fix.
      expect(report.rows[0]).toMatchObject({ diff: 'noop' });
      expect(await engine.deploy(declare())).toEqual({ local: 'noop' });
    });
  });
});

describe('the same request-shape and transient-failure fixes, once for Proxmox.Storage', () => {
  test('diff() propagates a transient read failure once a state row exists', async () => {
    const fake = clusterOverStorage('local', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxStorageProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ local: 'adopted' });
      fake.breakReads();
      // ⛔ THE FIX: this must REJECT, never resolve with a false 'update'.
      await expect(engine.verify(declare(), { all: true })).rejects.toBeDefined();
    });
  });

  test('alchemy drift never reports a transient failure as missing', async () => {
    const fake = clusterOverStorage('local', live);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxStorageProvider().pipe(Layer.provideMerge(fake.layer)));
      expect(await engine.deploy(declare())).toEqual({ local: 'adopted' });
      fake.breakReads();
      // ⛔ THE FIX: this must REJECT. Without `read`'s `output` branch it resolved with
      //   `{ local: { action: 'missing' } }` and no error anywhere — user.ts's/group.ts's own gap.
      await expect(engine.drift(declare())).rejects.toBeDefined();
    });
  });
});

/**
 * A fake cluster for a storage that does NOT exist yet: every GET is a 500 ("does not exist",
 * the measured shape) until `create()` fires, which records the POST body and starts answering
 * `live` afterward — so `reconcile`'s `before === undefined` branch, untouched by every test
 * above, actually runs.
 */
const clusterCreatingStorage = (id: string, live: Record<string, unknown>) => {
  let created = false;
  const posted: string[] = [];
  const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const request =
      input instanceof Request ? new Request(input, init) : new Request(String(input), init);
    const url = new URL(request.url);
    if (url.pathname.includes('/creds/')) {
      const data = { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' };
      return Response.json({ data, lease_duration: 0 });
    }
    const wire = decodeURIComponent(url.pathname.replace(/^\/api2\/json\//, ''));
    if (request.method === 'POST' && wire === 'storage') {
      posted.push(await request.text());
      created = true;
      return Response.json({ data: null });
    }
    if (wire !== `storage/${id}`) return Response.json({ data: null });
    if (!created) {
      return Response.json(
        { message: `storage '${id}' does not exist\n`, data: null },
        { status: 500 },
      );
    }
    return Response.json({ data: live });
  };
  const fetchStub = Object.assign(stub, { preconnect: globalThis.fetch.preconnect });
  return {
    posted,
    layer: FetchHttpClient.layer.pipe(
      Layer.provideMerge(Layer.succeed(FetchHttpClient.Fetch, fetchStub as typeof fetch)),
    ),
  };
};

describe('reconcile creating a brand-new storage — the before === undefined branch', () => {
  // ⛔ FOUND BY ADVERSARIAL REVIEW OF THIS PR: every test above adopts an EXISTING storage, so
  //   `reconcile`'s create branch (`toDistilledCreate`, the hyphen -> underscore translation) was
  //   never actually exercised — "correct by reading the generated SDK source", not by a test.
  test('translates a hyphenated locator field for the actual SDK call, not the vendor-check form', async () => {
    const newLive = {
      content: 'iso',
      'content-dirs': 'iso=/mnt/hf-test-new/iso',
      storage: 'hf-test-new',
      type: 'dir',
    };
    const fake = clusterCreatingStorage('hf-test-new', newLive);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxStorageProvider().pipe(Layer.provideMerge(fake.layer)));
      const declareNew = () =>
        ProxmoxStorage('newone', {
          content: 'iso',
          locator: { 'content-dirs': 'iso=/mnt/hf-test-new/iso', path: '/mnt/hf-test-new' },
          storage: 'hf-test-new',
          target: FAKE_TARGET,
          type: 'dir',
        });
      expect(await engine.deploy(declareNew())).toEqual({ newone: 'create' });
      expect(fake.posted).toHaveLength(1);
      // ★ MEASURED, NOT ASSUMED: the wire itself carries PVE's own hyphenated `content-dirs=`
      //   either way — distilled's generated `T.Body("content-dirs")` annotation re-hyphenates
      //   its underscored `content_dirs` property on the way out, and (confirmed by temporarily
      //   removing `underscored()` and re-running this exact test) an untranslated hyphenated key
      //   also reaches the wire unchanged as a passthrough "unknown key". `underscored()` is not
      //   about THIS field's own wire spelling, then — it is about routing every locator field
      //   through distilled's typed, declared property (comment further up `toDistilledCreate`),
      //   rather than the weaker unknown-key fallback, for whatever OTHER per-field wire logic a
      //   future plugin field might carry beyond a plain rename (a type coercion, a list join) —
      //   which this test cannot rule out for every field distilled might ever add.
      expect(fake.posted[0]).toContain('content-dirs=iso');
    });
  });

  test('a vendor-constraint violation on a hyphenated field is refused before any write', async () => {
    const fake = clusterCreatingStorage('hf-test-bad', {});
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxStorageProvider().pipe(Layer.provideMerge(fake.layer)));
      const declareBad = () =>
        ProxmoxStorage('bad', {
          // ⛔ `saferemove-stepsize` only allows 1/2/4/8/16/32 (generated/constraints/pve-storage.ts)
          //   — '99' must be refused by `guardWrite`, which proves it inspected the HYPHENATED
          //   key `createForm` builds, not the underscored one only the SDK call ever sees.
          locator: { path: '/mnt/hf-test-bad', 'saferemove-stepsize': '99' },
          storage: 'hf-test-bad',
          target: FAKE_TARGET,
          type: 'dir',
        });
      await expect(engine.deploy(declareBad())).rejects.toBeDefined();
      expect(fake.posted).toHaveLength(0);
    });
  });
});

/**
 * `Netbox.Prefix`'s `spec` against a fake NetBox, proving the real distilled wire path that
 * replaced `client.ts`'s hand-rolled `HttpClient` calls — path assembly, JSON encode/decode and
 * status→typed-error matching, exercised through `@distilled.cloud/netbox/ipam`'s real operations,
 * never re-implemented here. Mirrors `../forgejo/org-label.test.ts` and `repository.test.ts`'s
 * "call the exported production functions" shape (kit PR 180).
 *
 * ⛔ THE POINT OF THIS FILE. `resource.test.ts` proves `locateOne`/`soleMatch` in isolation with a
 *   fixture list; this file proves prefix.ts's own `spec.fetchLive`, `spec.attributes`,
 *   `spec.create`, `spec.update.call` and `spec.destroy` — the exact object `netboxHandlers(spec)`
 *   wraps into `NetboxPrefixProvider` — against a real HTTP round trip.
 */
import { describe, expect, test } from 'bun:test';
import type * as ipam from '@distilled.cloud/netbox/ipam';
import * as Effect from 'effect/Effect';
import { FAKE_BASE, fakeFailure, fakeNetbox, fakeNetboxLayer } from './fake-netbox.ts';
import type { PrefixProps } from './prefix.ts';
import { spec } from './prefix.ts';

const PREFIXES_PATH = '/api/ipam/prefixes/';
const PREFIX_ID_PATH = '/api/ipam/prefixes/7/';

/** A decodable `Prefix` — every field the SDK's schema requires present, per ipam.ts's interface. */
const livePrefix = (overrides: Record<string, unknown> = {}): ipam.Prefix =>
  ({
    _depth: 0,
    children: 0,
    comments: '',
    created: '2026-01-01T00:00:00Z',
    description: '',
    display: '10.0.0.0/24',
    display_url: `${FAKE_BASE}${PREFIX_ID_PATH}`,
    family: { label: 'IPv4', value: 4 },
    id: 7,
    is_pool: false,
    last_updated: '2026-01-01T00:00:00Z',
    mark_utilized: false,
    prefix: '10.0.0.0/24',
    scope: null,
    status: { label: 'Active', value: 'active' },
    url: `${FAKE_BASE}${PREFIX_ID_PATH}`,
    vrf: null,
    ...overrides,
  }) as unknown as ipam.Prefix;

/** `BriefVRF`/`BriefRIR`/`BriefVLAN` all require `id`, `url`, `display`, `name` — no `S.optional`. */
const briefVrf = (id: number, name: string) => ({
  display: name,
  id,
  name,
  url: `${FAKE_BASE}/api/ipam/vrfs/${String(id)}/`,
});
const briefTenant = (id: number, name: string) => ({
  display: name,
  id,
  name,
  slug: name,
  url: `${FAKE_BASE}/api/tenancy/tenants/${String(id)}/`,
});
const briefVlan = (id: number, name: string, vid: number) => ({
  display: name,
  id,
  name,
  url: `${FAKE_BASE}/api/ipam/vlans/${String(id)}/`,
  vid,
});

const readThrough = (fetchFn: typeof globalThis.fetch, props: PrefixProps) =>
  Effect.runPromise(
    spec.fetchLive(props).pipe(
      Effect.map((live) => (live === undefined ? undefined : spec.attributes(live, props))),
      Effect.provide(fakeNetboxLayer(fetchFn)),
    ),
  );

describe('Netbox.Prefix spec.fetchLive', () => {
  test('one server-side match, no VRF declared, decodes into the typed row', async () => {
    const fake = fakeNetbox((method, url) =>
      method === 'GET' && url.pathname === PREFIXES_PATH
        ? Response.json({ count: 1, next: null, previous: null, results: [livePrefix()] })
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec.fetchLive({ prefix: '10.0.0.0/24' }).pipe(Effect.provide(fakeNetboxLayer(fake.fetch))),
    );
    expect(live?.id).toBe(7);
    expect(fake.seen[0]?.method).toBe('GET');
    // ⚠️ Not just the path — the server-side filter this resource relies on to narrow
    //   candidates before `identifies` runs. A future distilled bump that changed how an
    //   array param serializes would silently stop narrowing on the wire; asserting only
    //   `pathname` would never catch that.
    const sent = new URL(`${FAKE_BASE}${fake.seen[0]?.path ?? ''}`);
    expect(sent.searchParams.getAll('prefix')).toEqual(['10.0.0.0/24']);
  });

  /**
   * 🔴 THE CASE `identifies` EXISTS FOR — the same VRF disambiguation prefix.ts's own docstring
   *   explains. `prefix` alone matched two rows (the same CIDR in two VRFs); the declared `vrf`
   *   picks the right one in this process, never by re-filtering server-side.
   */
  test('several rows for the same CIDR narrow to the declared VRF', async () => {
    const rows = [
      livePrefix({ id: 7, vrf: briefVrf(1, 'blue') }),
      livePrefix({ id: 8, vrf: briefVrf(2, 'red') }),
    ];
    const fake = fakeNetbox((method, url) =>
      method === 'GET' && url.pathname === PREFIXES_PATH
        ? Response.json({ count: 2, next: null, previous: null, results: rows })
        : fakeFailure(400, 'unexpected request'),
    );
    const live = await Effect.runPromise(
      spec
        .fetchLive({ prefix: '10.0.0.0/24', vrf: 2 })
        .pipe(Effect.provide(fakeNetboxLayer(fake.fetch))),
    );
    expect(live?.id).toBe(8);
  });

  test('no candidate rows is absent, not an error', async () => {
    const fake = fakeNetbox(() =>
      Response.json({ count: 0, next: null, previous: null, results: [] }),
    );
    const live = await Effect.runPromise(
      spec.fetchLive({ prefix: '10.20.30.0/24' }).pipe(Effect.provide(fakeNetboxLayer(fake.fetch))),
    );
    expect(live).toBeUndefined();
  });

  test('a 400 on the list propagates — never folded to absent', async () => {
    const fake = fakeNetbox(() => fakeFailure(400, 'prefix: invalid CIDR'));
    const failure = await Effect.runPromise(
      Effect.flip(
        spec.fetchLive({ prefix: 'not-a-cidr' }).pipe(Effect.provide(fakeNetboxLayer(fake.fetch))),
      ),
    );
    expect(failure._tag).toBe('BadRequest');
  });
});

describe('Netbox.Prefix spec.attributes — the actual exported production mapping', () => {
  test('status, foreign keys and free text all decode the way client.ts used to read them', async () => {
    const fake = fakeNetbox((method, url) =>
      method === 'GET' && url.pathname === PREFIXES_PATH
        ? Response.json({
            count: 1,
            next: null,
            previous: null,
            results: [
              livePrefix({
                comments: 'management range',
                description: 'core VLAN',
                is_pool: true,
                mark_utilized: true,
                status: { label: 'Deprecated', value: 'deprecated' },
                tenant: briefTenant(3, 'ops'),
                vlan: briefVlan(5, 'core', 10),
                vrf: briefVrf(1, 'blue'),
              }),
            ],
          })
        : fakeFailure(400, 'unexpected request'),
    );
    expect(await readThrough(fake.fetch, { prefix: '10.0.0.0/24', vrf: 1 })).toEqual({
      comments: 'management range',
      description: 'core VLAN',
      isPool: true,
      markUtilized: true,
      prefix: '10.0.0.0/24',
      prefixId: 7,
      status: 'deprecated',
      tenant: 3,
      vlan: 5,
      vrf: 1,
    });
  });
});

describe('Netbox.Prefix spec.create / spec.update.call / spec.destroy — the real wire calls', () => {
  const props: PrefixProps = { description: 'core VLAN', prefix: '10.0.0.0/24', status: 'active' };
  const update = spec.update;
  if (update === undefined) throw new Error('Netbox.Prefix must declare spec.update');

  test('create POSTs the constraint-checked body to /api/ipam/prefixes/', async () => {
    const fake = fakeNetbox((method, url) =>
      method === 'POST' && url.pathname === PREFIXES_PATH
        ? Response.json(livePrefix({ description: 'core VLAN' }), { status: 201 })
        : fakeFailure(400, 'unexpected request'),
    );
    const body = spec.createBody(props);
    const live = await Effect.runPromise(
      spec.create(props, body).pipe(Effect.provide(fakeNetboxLayer(fake.fetch))),
    );
    expect((live as ipam.Prefix).id).toBe(7);
    expect(fake.seen).toEqual([{ method: 'POST', path: PREFIXES_PATH }]);
  });

  test('update PATCHes /api/ipam/prefixes/{id}/, addressed by the live row numeric id', async () => {
    const fake = fakeNetbox((method, url) =>
      method === 'PATCH' && url.pathname === PREFIX_ID_PATH
        ? Response.json(livePrefix({ status: { label: 'Deprecated', value: 'deprecated' } }))
        : fakeFailure(400, 'unexpected request'),
    );
    const declared = { ...props, status: 'deprecated' as const };
    const body = update.body(declared);
    const after = await Effect.runPromise(
      update.call(declared, livePrefix(), body).pipe(Effect.provide(fakeNetboxLayer(fake.fetch))),
    );
    expect((after as ipam.Prefix).status?.value).toBe('deprecated');
    expect(fake.seen).toEqual([{ method: 'PATCH', path: PREFIX_ID_PATH }]);
  });

  test('destroy DELETEs /api/ipam/prefixes/{id}/', async () => {
    const fake = fakeNetbox((method, url) =>
      method === 'DELETE' && url.pathname === PREFIX_ID_PATH
        ? new Response(null, { status: 204 })
        : fakeFailure(400, 'unexpected request'),
    );
    await Effect.runPromise(
      spec.destroy(props, livePrefix()).pipe(Effect.provide(fakeNetboxLayer(fake.fetch))),
    );
    expect(fake.seen).toEqual([{ method: 'DELETE', path: PREFIX_ID_PATH }]);
  });
});

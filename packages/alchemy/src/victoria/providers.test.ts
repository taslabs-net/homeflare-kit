/**
 * The Alchemy wiring: the provider built as a Layer over a fake host and a fake `HttpClient`, its
 * handlers called the way the engine calls them — plus the barrel, the subpath's public API.
 *
 * ★ `read` with no prior state is the adoption probe. A binary already at the path comes back
 *   `Unowned`, recognised by its digest; after `--adopt` the forced update finds it matching and
 *   neither downloads nor writes. The plan-time refusals happen with zero requests and zero writes.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned, stripUnowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as HttpClient from 'effect/unstable/http/HttpClient';
import * as HttpClientResponse from 'effect/unstable/http/HttpClientResponse';
import { hostRunnerLayer } from '../launchd/runner.ts';
import { VictoriaBinary, makeVictoriaBinaryProvider } from './binary.ts';
import { VICTORIA_CATALOG, type VictoriaCatalog } from './catalog.ts';
import {
  BINARY,
  VMALERT,
  VMUTILS,
  VMUTILS_DIR,
  pathsOn,
  syntheticRelease,
  victoriaHost,
} from './fake-release.ts';
import * as barrel from './index.ts';
import { victoriaProviders } from './providers.ts';

const ids = { fqn: 'stack/vmalert', id: 'vmalert', instanceId: 'i-1' };
const call = { bindings: [] as never, newBindings: [] as never, oldBindings: [] as never };
const PATH = `${VMUTILS_DIR}/vmalert`;

type Service = Effect.Success<typeof VictoriaBinary.Provider>;

/** One provider over one fake host and one fake HTTP server; `requests` counts every URL asked. */
const harness = (catalogOf: (synthetic: VictoriaCatalog) => VictoriaCatalog = (c) => c) => {
  const release = syntheticRelease();
  const fake = victoriaHost();
  const requests: string[] = [];
  const notes: string[] = [];
  const client = HttpClient.make((request, url) => {
    requests.push(url.toString());
    const body = url.toString() === VMUTILS.url ? new Blob([release.vmutils.slice()]) : null;
    return Effect.succeed(
      HttpClientResponse.fromWeb(request, new Response(body, { status: body ? 200 : 404 })),
    );
  });
  const layer = makeVictoriaBinaryProvider({ catalog: catalogOf(release.catalog) }).pipe(
    Layer.provide(
      Layer.mergeAll(hostRunnerLayer(fake.runner), Layer.succeed(HttpClient.HttpClient, client)),
    ),
  );
  const session = { note: (m: string) => Effect.sync(() => void notes.push(m)) } as never;
  const run = <A>(use: (p: Service) => Effect.Effect<A, unknown>) =>
    Effect.runPromise(
      Effect.gen(function* () {
        return yield* use(yield* VictoriaBinary.Provider);
      }).pipe(Effect.provide(layer)) as Effect.Effect<A>,
    );
  const reconcile = (p: Service, news: object, output?: unknown) =>
    p.reconcile({
      ...ids,
      ...call,
      news: news as never,
      olds: undefined,
      output: output as never,
      session,
    });
  return { fake, notes, reconcile, release, requests, run };
};

const must = <F>(fn: F | undefined): F => {
  if (fn === undefined) throw new Error('provider has no such handler');
  return fn;
};

describe('plan-time refusals: zero requests, zero writes', () => {
  test('the adoption probe refuses a version the REAL catalog does not pin', async () => {
    const h = harness(() => VICTORIA_CATALOG);
    const next = { ...VMALERT, directory: '/opt/example/bin/vmutils-1.152.0', version: '1.152.0' };
    const probe = h.run((p) => must(p.read)({ ...ids, olds: next as never, output: undefined }));
    await expect(probe).rejects.toThrow('vmutils 1.152.0 is not in the catalog');
    expect(h.requests).toEqual([]);
    expect(h.fake.calls).toEqual([]);
  });

  test('diff refuses an unpinned version even while the directory is still an Output', async () => {
    const h = harness();
    const output = await h.run((p) => h.reconcile(p, VMALERT));
    h.requests.length = 0;
    const pending = {
      ...VMALERT,
      directory: Effect.succeed(VMUTILS_DIR),
      version: '1.151.0-enterprise',
    };
    const diff = h.run((p) =>
      must(p.diff)({ ...ids, ...call, news: pending as never, olds: VMALERT as never, output }),
    );
    await expect(diff).rejects.toThrow('1.151.0-enterprise is not in the catalog');
    expect(h.requests).toEqual([]);
  });
});

describe('the lifecycle through the engine-facing handlers', () => {
  test('reconcile installs, noting progress; diff is then a noop, a mode change an update', async () => {
    const h = harness();
    const [output, same, mode] = await h.run((p) =>
      Effect.gen(function* () {
        const output = yield* h.reconcile(p, VMALERT);
        const diff = must(p.diff);
        const base = { ...ids, ...call, olds: VMALERT as never, output };
        return [
          output,
          yield* diff({ ...base, news: VMALERT as never }),
          yield* diff({ ...base, news: { ...VMALERT, mode: 0o555 } as never }),
        ] as const;
      }),
    );
    expect(output.sha256).toBe(new Bun.CryptoHasher('sha256').update(BINARY.vmalert).digest('hex'));
    expect([same, mode]).toEqual([{ action: 'noop' }, { action: 'update' }]);
    expect(h.notes.some((n) => n.startsWith('downloading '))).toBe(true);
  });

  test('a version change is a replace even while the directory is an Output', async () => {
    // A second pinned version, so the diff reaches the question of the path.
    const h = harness((c) => {
      const versions = { ...c.vmutils.versions, '1.152.0': c.vmutils.versions['1.151.0'] ?? {} };
      return { ...c, vmutils: { ...c.vmutils, versions } };
    });
    const diffs = await h.run((p) =>
      Effect.gen(function* () {
        const output = yield* h.reconcile(p, VMALERT);
        const base = { ...ids, ...call, olds: VMALERT as never, output };
        const pending = {
          ...VMALERT,
          directory: Effect.succeed('/opt/example/bin/vmutils-1.152.0'),
        };
        return [
          yield* must(p.diff)({ ...base, news: { ...pending, version: '1.152.0' } as never }),
          yield* must(p.diff)({ ...base, news: pending as never }),
        ];
      }),
    );
    // ★ The engine's default for a changed prop is an update, which would overwrite in place.
    expect(diffs).toEqual([{ action: 'replace' }, undefined]);
  });

  test('a binary someone already placed: Unowned by digest, then adopted with no download', async () => {
    const h = harness();
    h.fake.files.set(PATH, { bytes: BINARY.vmalert, gid: 0, kind: 'file', mode: 0o755, uid: 0 });
    const before = pathsOn(h.fake);
    const [probe, adopted] = await h.run((p) =>
      Effect.gen(function* () {
        const probe = yield* must(p.read)({ ...ids, olds: VMALERT as never, output: undefined });
        if (probe === undefined) throw new Error('nothing found');
        // What the engine does after `--adopt`: strip the brand, then force an update.
        const adopted = yield* h.reconcile(p, VMALERT, stripUnowned(probe));
        return [probe, adopted] as const;
      }),
    );
    expect(Unowned.is(probe)).toBe(true);
    expect(probe.sha256).toBe(adopted.sha256);
    expect(adopted).toMatchObject({ member: 'vmalert-prod', path: PATH, url: VMUTILS.url });
    expect(h.requests).toEqual([]);
    expect(h.fake.calls.filter((c) => c[0] === 'write')).toEqual([]);
    expect(pathsOn(h.fake)).toEqual(before);
  });

  test('vmagent and vmalert at once: ONE download of the shared archive', async () => {
    const h = harness();
    const vmagent = { ...VMALERT, binary: 'vmagent' };
    await h.run((p) =>
      Effect.all([h.reconcile(p, VMALERT), h.reconcile(p, vmagent)], { concurrency: 'unbounded' }),
    );
    expect(h.requests).toEqual([VMUTILS.url]);
    expect(pathsOn(h.fake)).toEqual([`${VMUTILS_DIR}/vmagent`, PATH]);
  });

  test('delete removes the binary and never the directory', async () => {
    const h = harness();
    await h.run((p) =>
      Effect.gen(function* () {
        const output = yield* h.reconcile(p, VMALERT);
        yield* p.delete({
          ...ids,
          bindings: [] as never,
          olds: VMALERT as never,
          output,
          session: undefined as never,
        });
      }),
    );
    expect(h.fake.files.has(PATH)).toBe(false);
    expect(h.fake.dirs.has(VMUTILS_DIR)).toBe(true);
  });
});

describe('the subpath', () => {
  test('victoriaProviders builds with its own HTTP client, and a probe of nothing is nothing', async () => {
    const fake = victoriaHost();
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* VictoriaBinary.Provider;
        return yield* must(p.read)({ ...ids, olds: VMALERT as never, output: undefined });
      }).pipe(Effect.provide(victoriaProviders(fake.runner))),
    );
    expect(found).toBeUndefined();
  });

  test('the barrel is exactly the public API', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'ArchiveRefused',
      'BinaryRefused',
      'ChecksumMismatch',
      'DownloadFailed',
      'HostRunnerService',
      'VICTORIA_CATALOG',
      'VictoriaBinary',
      'VictoriaBinaryProvider',
      'hostRunnerLayer',
      'identifyVictoriaBinary',
      'releaseProblems',
      'resolveVictoriaRelease',
      'victoriaBinaryPath',
      'victoriaDirectory',
      'victoriaProviders',
    ]);
  });
});

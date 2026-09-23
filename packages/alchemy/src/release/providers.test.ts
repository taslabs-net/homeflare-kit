/**
 * The Alchemy wiring: the provider built as a Layer over a fake host and a fake `HttpClient`, its
 * handlers called the way the engine calls them — plus the barrel, the subpath's public API.
 *
 * ★ `read` with no prior state is the adoption probe. A binary already at the path comes back
 *   `Unowned`, recognised by its digest; after `--adopt` the forced update finds it matching and
 *   neither downloads nor writes. The plan-time refusals: provider-refusals.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned, stripUnowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import { ReleaseBinary } from './binary.ts';
import {
  BINARY,
  VMUTILS_DIR,
  VMUTILS_URL,
  pathsOn,
  releaseHost,
  syntheticRelease,
  vmalertProps,
} from './fake-release.ts';
import { PATH, call, harness, ids, must } from './fake-provider.ts';
import * as barrel from './index.ts';
import { releaseProviders } from './providers.ts';

describe('the lifecycle through the engine-facing handlers', () => {
  test('reconcile installs, noting progress; diff is then a noop, a mode change an update', async () => {
    const h = harness();
    const [output, same, mode] = await h.run((p) =>
      Effect.gen(function* () {
        const output = yield* h.reconcile(p, h.VMALERT);
        const diff = must(p.diff);
        const base = { ...ids, ...call, olds: h.VMALERT as never, output };
        return [
          output,
          yield* diff({ ...base, news: h.VMALERT as never }),
          yield* diff({ ...base, news: { ...h.VMALERT, mode: 0o555 } as never }),
        ] as const;
      }),
    );
    expect(output.sha256).toBe(new Bun.CryptoHasher('sha256').update(BINARY.vmalert).digest('hex'));
    expect([same, mode]).toEqual([{ action: 'noop' }, { action: 'update' }]);
    expect(h.notes.some((n) => n.startsWith('downloading '))).toBe(true);
  });

  test('while the directory is an Output: other bytes are a replace, the same bytes an update', async () => {
    const h = harness();
    const diffs = await h.run((p) =>
      Effect.gen(function* () {
        const output = yield* h.reconcile(p, h.VMALERT);
        const base = { ...ids, ...call, olds: h.VMALERT as never, output };
        const pending = { ...h.VMALERT, directory: Effect.succeed(`${VMUTILS_DIR}-next`) };
        const archive = { ...h.VMALERT.archive, tag: 'v1.152.0' };
        const diff = (news: object) => must(p.diff)({ ...base, news: news as never });
        return [
          yield* diff({ ...pending, archive, sha256: 'e'.repeat(64) }),
          yield* diff({ ...pending, archive }),
          yield* diff(pending),
        ];
      }),
    );
    // ★ Never `replace` for the same bytes: onto an unmoved path, the new generation would accept
    //   the old file as its own and Phase 2 would then delete it (binary-diff.ts).
    expect(diffs).toEqual([{ action: 'replace' }, { action: 'update' }, undefined]);
  });

  test('that update, if the path did not move after all, is refused at apply', async () => {
    const h = harness();
    const output = await h.run((p) => h.reconcile(p, h.VMALERT));
    h.requests.length = 0;
    const repinned = { ...h.VMALERT, archive: { ...h.VMALERT.archive, tag: 'v1.152.0' } };
    const applying = h.run((p) => h.reconcile(p, repinned, output, h.VMALERT));
    await expect(applying).rejects.toThrow('would overwrite it in place');
    expect(h.requests).toEqual([]);
    expect(h.fake.files.get(PATH)?.bytes).toEqual(BINARY.vmalert);
  });

  test('a binary someone already placed: Unowned by digest, then adopted with no download', async () => {
    const h = harness();
    h.fake.files.set(PATH, { bytes: BINARY.vmalert, gid: 0, kind: 'file', mode: 0o755, uid: 0 });
    const before = pathsOn(h.fake);
    const [probe, adopted] = await h.run((p) =>
      Effect.gen(function* () {
        const probe = yield* must(p.read)({ ...ids, olds: h.VMALERT as never, output: undefined });
        if (probe === undefined) throw new Error('nothing found');
        // What the engine does after `--adopt`: strip the brand, then force an update.
        const adopted = yield* h.reconcile(p, h.VMALERT, stripUnowned(probe));
        return [probe, adopted] as const;
      }),
    );
    expect(Unowned.is(probe)).toBe(true);
    // ★ Recognised by its digest alone: the probe's sha256 IS the pin; nothing was executed.
    expect(probe.sha256).toBe(h.VMALERT.sha256);
    expect(adopted).toMatchObject({
      member: 'vmalert-prod',
      path: PATH,
      sha256: h.VMALERT.sha256,
      url: VMUTILS_URL,
    });
    expect(h.requests).toEqual([]);
    expect(h.fake.calls.filter((c) => c[0] === 'write')).toEqual([]);
    expect(pathsOn(h.fake)).toEqual(before);
  });

  test('vmagent and vmalert at once: ONE download of the shared archive', async () => {
    const h = harness();
    const vmagent = {
      ...h.VMALERT,
      member: 'vmagent-prod',
      name: 'vmagent',
      sha256: new Bun.CryptoHasher('sha256').update(BINARY.vmagent).digest('hex'),
    };
    await h.run((p) =>
      Effect.all([h.reconcile(p, h.VMALERT), h.reconcile(p, vmagent)], {
        concurrency: 'unbounded',
      }),
    );
    expect(h.requests).toEqual([VMUTILS_URL]);
    expect(pathsOn(h.fake)).toEqual([`${VMUTILS_DIR}/vmagent`, PATH]);
  });

  test('delete removes the binary and never the directory', async () => {
    const h = harness();
    await h.run((p) =>
      Effect.gen(function* () {
        const output = yield* h.reconcile(p, h.VMALERT);
        yield* p.delete({
          ...ids,
          bindings: [] as never,
          olds: h.VMALERT as never,
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
  test('releaseProviders builds with its own HTTP client, and a probe of nothing is nothing', async () => {
    const fake = releaseHost();
    const VMALERT = vmalertProps(syntheticRelease().catalog);
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const p = yield* ReleaseBinary.Provider;
        return yield* must(p.read)({ ...ids, olds: VMALERT as never, output: undefined });
      }).pipe(Effect.provide(releaseProviders(fake.runner))),
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
      'OPENBAO_RELEASES',
      'ReleaseBinary',
      'ReleaseBinaryProvider',
      'VICTORIA_RELEASES',
      'catalogBinary',
      'catalogDirectory',
      'catalogProblems',
      'hostRunnerLayer',
      'identifyBinary',
      'releaseBinaryPath',
      'releaseProviders',
      'releaseUrl',
    ]);
  });
});

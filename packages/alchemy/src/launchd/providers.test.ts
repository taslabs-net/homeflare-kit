/**
 * The Alchemy wiring: each provider built as a Layer over a fake HostRunner, its handlers called
 * the way the engine calls them — plus the barrel, which is the subpath's public API.
 *
 * ★ `read` with no prior state is the adoption probe. Anything found must come back `Unowned`, or
 *   Alchemy would silently take over a job or file some other tool (or a person) put there.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { fakeRunner } from './fake-runner.ts';
import { HostFile, HostFileProvider } from './host-file.ts';
import * as barrel from './index.ts';
import { LaunchdJob, LaunchdJobProvider } from './job.ts';
import type { LaunchdJobProps } from './job-form.ts';
import { launchdProviders } from './providers.ts';
import { hostRunnerLayer } from './runner.ts';

const job: LaunchdJobProps = {
  domain: 'system',
  label: 'com.example.job',
  programArguments: ['/usr/local/bin/job'],
};
const ids = { fqn: 'stack/job', id: 'job', instanceId: 'i-1' };

/** A handler the provider must define; a missing one fails the test by name. */
const handler = <F>(name: string, fn: F | undefined): F => {
  if (fn === undefined) throw new Error(`provider has no ${name} handler`);
  return fn;
};

const host = () =>
  fakeRunner({ dirs: { '/Library/LaunchDaemons': 0, '/etc/example': 0 }, euid: 0 });

const withJobProvider = <A>(
  fake: ReturnType<typeof host>,
  use: (p: Effect.Success<typeof LaunchdJob.Provider>) => Effect.Effect<A, Error>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* use(yield* LaunchdJob.Provider);
    }).pipe(Effect.provide(LaunchdJobProvider().pipe(Layer.provide(hostRunnerLayer(fake.runner))))),
  );

describe('LaunchdJobProvider', () => {
  test('reconcile, then read with state (owned) and without (Unowned)', async () => {
    const fake = host();
    const [owned, probe] = await withJobProvider(fake, (provider) =>
      Effect.gen(function* () {
        const session = undefined as never;
        const output = yield* provider.reconcile({
          ...ids,
          bindings: [] as never,
          news: job,
          olds: undefined,
          output: undefined,
          session,
        });
        const owned = yield* handler('read', provider.read)({ ...ids, olds: job, output });
        const probe = yield* handler(
          'read',
          provider.read,
        )({ ...ids, olds: job, output: undefined });
        return [owned, probe] as const;
      }),
    );
    expect(Unowned.is(owned)).toBe(false);
    expect(Unowned.is(probe)).toBe(true);
    expect(probe).toMatchObject({ label: 'com.example.job', loaded: true });
  });

  test('diff defers to the engine when there is no prior output', async () => {
    const diff = await withJobProvider(host(), (provider) =>
      Effect.map(
        handler(
          'diff',
          provider.diff,
        )({
          ...ids,
          news: job,
          newBindings: [] as never,
          oldBindings: [] as never,
          olds: job,
          output: undefined,
        }),
        (value) => value,
      ),
    );
    expect(diff).toBeUndefined();
  });

  test('a refusal reaches Alchemy as a failure carrying its message', async () => {
    const fake = fakeRunner({ dirs: { '/Library/LaunchDaemons': 0 }, euid: 501 });
    await expect(
      withJobProvider(fake, (provider) =>
        provider.reconcile({
          ...ids,
          bindings: [] as never,
          news: job,
          olds: undefined,
          output: undefined,
          session: undefined as never,
        }),
      ),
    ).rejects.toThrow('never calls sudo');
  });
});

describe('HostFileProvider', () => {
  test('a file already on disk probes as Unowned', async () => {
    const fake = host();
    fake.files.set('/etc/example/a.conf', {
      bytes: new Uint8Array([120]),
      gid: 0,
      kind: 'file',
      mode: 0o644,
      uid: 0,
    });
    const found = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* HostFile.Provider;
        return yield* handler(
          'read',
          provider.read,
        )({ ...ids, olds: { content: 'x', path: '/etc/example/a.conf' }, output: undefined });
      }).pipe(Effect.provide(HostFileProvider().pipe(Layer.provide(hostRunnerLayer(fake.runner))))),
    );
    expect(Unowned.is(found)).toBe(true);
    expect(found).toMatchObject({ path: '/etc/example/a.conf', size: 1 });
  });
});

describe('launchdProviders', () => {
  test('provides both providers from one runner', async () => {
    const both = await Effect.runPromise(
      Effect.gen(function* () {
        return [yield* LaunchdJob.Provider, yield* HostFile.Provider];
      }).pipe(Effect.provide(launchdProviders(host().runner))),
    );
    expect(both).toHaveLength(2);
  });
});

describe('the barrel', () => {
  test('exports the public surface and nothing test-only or internal', () => {
    expect(Object.keys(barrel).sort()).toEqual([
      'HostFile',
      'HostFileProvider',
      'HostRunnerService',
      'LaunchdJob',
      'LaunchdJobProvider',
      'PlistError',
      'canActAsRoot',
      'hostRunnerLayer',
      'launchdProviders',
      'localRunner',
      'renderPlist',
    ]);
  });
});

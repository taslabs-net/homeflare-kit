/**
 * `--adopt` and `adopt(…)` at APPLY, for HostFile and LaunchdJob — the create Alchemy never probed
 * (a prop still an Output at plan time). Before 2026-09-21 these reconciles refused a foreign file
 * or job whatever the deploy said, so the flag the refusal told you to use could not work there.
 * They now resolve adoption the way the planner does (ownership/adopt.ts adoptEnabled), BOTH ways —
 * for a CREATE only: the row Apply committed for this instance is `creating`. ⛔ A replace's new
 * generation (a `replacing` row, `output` undefined all the same) is never adoptable at apply.
 * ★ Registered through the REAL `Resource` under a Stack, as caddy/adopt-scope.test.ts is, over a
 *   state store holding the row Apply commits before it calls reconcile.
 */
import { describe, expect, test } from 'bun:test';
import { AdoptPolicy, adopt } from 'alchemy/AdoptPolicy';
import { Artifacts, makeScopedArtifacts } from 'alchemy/Artifacts';
import { InMemoryService } from 'alchemy/State/InMemoryState';
import type { ResourceState } from 'alchemy/State/ResourceState';
import { State } from 'alchemy/State/State';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import { noteUnfinished } from '../ownership/resume.ts';
import { fakeRunner } from './fake-runner.ts';
import { HostFile, HostFileProvider } from './host-file.ts';
import { LaunchdJob, LaunchdJobProvider } from './job.ts';
import type { LaunchdJobAttributes } from './job-form.ts';
import { hostRunnerLayer } from './runner.ts';

type Scope = 'adopt(true)' | 'adopt(false)' | 'none';

const FOREIGN = new TextEncoder().encode('someone else wrote this\n');
const PATH = '/etc/example/a.conf';
const PLIST = '/Library/LaunchDaemons/com.example.job.plist';
const JOB = { domain: 'system', label: 'com.example.job', programArguments: ['/bin/job'] } as const;

const host = () => {
  const fake = fakeRunner({ dirs: { '/Library/LaunchDaemons': 0, '/etc/example': 0 }, euid: 0 });
  for (const path of [PATH, PLIST]) {
    fake.files.set(path, { bytes: FOREIGN, gid: 0, kind: 'file', mode: 0o644, uid: 0 });
  }
  return fake;
};

const scoped = <A extends Effect.Effect<unknown, unknown, unknown>>(declared: A, scope: Scope) =>
  scope === 'none' ? declared : (declared.pipe(adopt(scope === 'adopt(true)')) as A);

/** The row Apply commits before reconcile: a create's, or a replace's new generation's. */
type Generation = 'creating' | 'replacing';

/** Register `family` with `scope` under a deploy whose `--adopt` is `flag`; reconcile it statelessly. */
const firstApply = (
  family: 'file' | 'job',
  scope: Scope,
  flag: boolean,
  output?: unknown,
  generation: Generation = 'creating',
  /** The plan's diff saw this generation's row with no attributes (ownership/resume.ts). */
  unfinished = false,
) => {
  const fake = host();
  const fqn = family === 'file' ? 'conf' : 'job';
  const row = { fqn, instanceId: 'i-1', status: generation } as unknown as ResourceState;
  const spec = { actions: {}, bindings: {}, name: 'test', resources: {}, stage: 'test' };
  const call = {
    bindings: [] as never,
    instanceId: 'i-1',
    olds: undefined,
    session: undefined as never,
  };
  const program: Effect.Effect<unknown, unknown, AdoptPolicy | Stack> =
    family === 'file'
      ? Effect.gen(function* () {
          yield* scoped(HostFile('conf', { content: 'x', path: PATH }), scope);
          const provider = yield* HostFile.Provider;
          const news = { content: 'x', path: PATH };
          return yield* provider.reconcile({
            ...call,
            fqn: 'conf',
            id: 'conf',
            news,
            output: undefined,
          });
        }).pipe(
          Effect.provide(HostFileProvider().pipe(Layer.provide(hostRunnerLayer(fake.runner)))),
        )
      : Effect.gen(function* () {
          yield* scoped(LaunchdJob('job', JOB), scope);
          const provider = yield* LaunchdJob.Provider;
          const prior = output as LaunchdJobAttributes | undefined;
          return yield* provider.reconcile({
            ...call,
            fqn: 'job',
            id: 'job',
            news: JOB,
            output: prior,
          });
        }).pipe(
          Effect.provide(LaunchdJobProvider().pipe(Layer.provide(hostRunnerLayer(fake.runner)))),
        );
  const bag = makeScopedArtifacts(new Map(), fqn);
  const noted = unfinished ? noteUnfinished('i-1') : Effect.void;
  const applying = Effect.runPromise(
    Effect.andThen(noted, program).pipe(
      Effect.provideService(Artifacts, bag),
      Effect.provideService(AdoptPolicy, flag),
      Effect.provideService(State, InMemoryService({ test: { test: { [fqn]: row } } })),
      Effect.provideService(Stack, spec as never),
    ),
  );
  return { applying, fake };
};

const REFUSED = /already exists and is not this resource|is already on this host/;

describe.each(['file', 'job'] as const)('%s: a first apply over a foreign object', (family) => {
  test.each([
    ['adopt(false) under --adopt', 'adopt(false)', true, false],
    ['adopt(true) without --adopt', 'adopt(true)', false, true],
    ['no scope under --adopt', 'none', true, true],
    ['no scope without --adopt', 'none', false, false],
  ] as const)('with %s', async (_, scope, flag, takesOver) => {
    const { applying, fake } = firstApply(family, scope, flag);
    const path = family === 'file' ? PATH : PLIST;
    if (takesOver) {
      await applying;
      expect(fake.files.get(path)?.bytes).not.toEqual(FOREIGN);
    } else {
      await expect(applying).rejects.toThrow(REFUSED);
      expect(fake.files.get(path)?.bytes).toEqual(FOREIGN);
    }
  });
});

test('a LaunchdJob rename onto a foreign job stays refused, --adopt or not', async () => {
  const old = {
    domain: 'system',
    label: 'com.example.old',
    loaded: false,
    plistPath: '/Library/LaunchDaemons/com.example.old.plist',
    plistSha256: '',
    serviceTarget: 'system/com.example.old',
  };
  const { applying, fake } = firstApply('job', 'adopt(true)', true, old);
  await expect(applying).rejects.toThrow(REFUSED);
  expect(fake.files.get(PLIST)?.bytes).toEqual(FOREIGN);
});

describe.each(['file', 'job'] as const)('%s: a replace onto a foreign object', (family) => {
  test.each([
    ['--adopt', 'none', true],
    ['adopt(true)', 'adopt(true)', false],
  ] as const)(
    'stays refused under %s: the plan never offered its new generation adoption',
    async (_, scope, flag) => {
      const { applying, fake } = firstApply(family, scope, flag, undefined, 'replacing');
      await expect(applying).rejects.toThrow(REFUSED);
      expect(fake.files.get(family === 'file' ? PATH : PLIST)?.bytes).toEqual(FOREIGN);
    },
  );

  test('an UNFINISHED replace (its row seen by the plan) resumes under --adopt, as a create does', async () => {
    const refused = firstApply(family, 'none', false, undefined, 'replacing', true);
    await expect(refused.applying).rejects.toThrow(REFUSED);
    const { applying, fake } = firstApply(family, 'none', true, undefined, 'replacing', true);
    await applying;
    expect(fake.files.get(family === 'file' ? PATH : PLIST)?.bytes).not.toEqual(FOREIGN);
  });
});

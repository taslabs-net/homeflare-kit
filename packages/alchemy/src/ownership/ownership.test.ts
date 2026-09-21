/**
 * The engine-facing edges of ownership/: which instance a read is about, what a resume note is
 * worth without a shared bag, and that a `settled` check that cannot run never fails the plan.
 * The families' end-to-end behaviour is pinned through the engine in openbao/adopt-*.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { Unowned } from 'alchemy/AdoptPolicy';
import { Artifacts, makeScopedArtifacts } from 'alchemy/Artifacts';
import { InMemoryService } from 'alchemy/State/InMemoryState';
import type { ResourceState } from 'alchemy/State/ResourceState';
import { State } from 'alchemy/State/State';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import { refuseTakeover } from './adopt.ts';
import { ownedRead } from './probe.ts';
import { noteResume, resumes } from './resume.ts';
import { forgetRefusedCreate, recordedInstance } from './rows.ts';

const row = (fqn: string, instanceId: string, old?: unknown): ResourceState =>
  ({ fqn, instanceId, old, status: old === undefined ? 'creating' : 'replacing' }) as never;

/** A stack `s` at stage `test` whose store holds `rows`, and `Z` declared `renamedFrom('X')`. */
const withStore = <A>(rows: Record<string, ResourceState>, effect: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(State, InMemoryService({ s: { test: rows } })),
      Effect.provideService(Stack, {
        actions: {},
        bindings: {},
        name: 's',
        resources: { Z: { FormerFqns: ['X'] } },
        stage: 'test',
      } as never),
    ),
  );

describe('recordedInstance', () => {
  test('is the row at the FQN, any generation of its `old` chain, or a renamedFrom row', async () => {
    const rows = { A: row('A', 'new', row('A', 'older')), X: row('X', 'moved') };
    expect(await withStore(rows, recordedInstance('A', 'new'))).toBe(true);
    expect(await withStore(rows, recordedInstance('A', 'older'))).toBe(true);
    expect(await withStore(rows, recordedInstance('Z', 'moved'))).toBe(true);
  });

  test("the probe's freshly minted instance is never recorded", async () => {
    expect(await withStore({ A: row('A', 'mine') }, recordedInstance('A', 'probe'))).toBe(false);
    expect(await withStore({}, recordedInstance('A', 'mine'))).toBe(false);
  });

  test('fails closed with no Stack or State in context', async () => {
    expect(await Effect.runPromise(recordedInstance('A', 'mine'))).toBe(false);
  });
});

describe('forgetRefusedCreate', () => {
  test('drops only the creating row of this instance, with no attributes', async () => {
    const rows: Record<string, ResourceState> = {
      A: row('A', 'mine'),
      B: row('B', 'mine', row('B', 'older')),
      C: row('C', 'theirs'),
      D: { ...row('D', 'mine'), attr: { name: 'd' } },
    };
    for (const fqn of ['A', 'B', 'C', 'D']) await withStore(rows, forgetRefusedCreate(fqn, 'mine'));
    expect(Object.keys(rows).sort()).toEqual(['B', 'C', 'D']);
  });
});

describe('ownedRead', () => {
  const found = { name: 'a' };
  const ask = (output?: unknown) => ({ fqn: 'A', instanceId: 'mine', output });
  const rows = { A: row('A', 'mine') };

  test('with state it is the object as found; absent is absent', async () => {
    const plain = await Effect.runPromise(ownedRead(ask({}), found, Effect.succeed(false)));
    expect(Unowned.is(plain)).toBe(false);
    expect(await Effect.runPromise(ownedRead(ask(), undefined, Effect.succeed(true)))).toBe(
      undefined,
    );
  });

  test('the probe answers Unowned even when the object is settled', async () => {
    const probed = await withStore({}, ownedRead(ask(), found, Effect.succeed(true)));
    expect(Unowned.is(probed)).toBe(true);
  });

  test('the recovery read is ours only when settled', async () => {
    expect(Unowned.is(await withStore(rows, ownedRead(ask(), found, Effect.succeed(true))))).toBe(
      false,
    );
    expect(Unowned.is(await withStore(rows, ownedRead(ask(), found, Effect.succeed(false))))).toBe(
      true,
    );
  });

  test('a settled check that fails or dies is Unowned, never a failed plan', async () => {
    const failing = Effect.fail(new Error('fragments directory moved'));
    const dying = Effect.die(new TypeError('olds.tokenPolicies is undefined'));
    expect(Unowned.is(await withStore(rows, ownedRead(ask(), found, failing)))).toBe(true);
    expect(Unowned.is(await withStore(rows, ownedRead(ask(), found, dying)))).toBe(true);
  });
});

describe('resume notes and refuseTakeover', () => {
  const bag = makeScopedArtifacts(new Map(), 'A');
  const inBag = <A>(effect: Effect.Effect<A>) =>
    Effect.runPromise(effect.pipe(Effect.provideService(Artifacts, bag)));

  test('a note is read back for its own instance only, and nothing is noted without a bag', async () => {
    await inBag(noteResume('mine'));
    expect(await inBag(resumes('mine'))).toBe(true);
    expect(await inBag(resumes('other'))).toBe(false);
    await Effect.runPromise(noteResume('mine'));
    expect(await Effect.runPromise(resumes('mine'))).toBe(false);
  });

  test('refuses a create with no note and no adoption; state or a note lets it through', async () => {
    const owner = { fqn: 'A', instanceId: 'mine', output: undefined };
    await expect(Effect.runPromise(refuseTakeover(owner, 'Thing a'))).rejects.toThrow(
      /Thing a: already exists.*--adopt/s,
    );
    await Effect.runPromise(refuseTakeover({ ...owner, output: {} }, 'Thing a'));
    await inBag(noteResume('mine'));
    await inBag(refuseTakeover(owner, 'Thing a'));
  });
});

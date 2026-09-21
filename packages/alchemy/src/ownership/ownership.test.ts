/**
 * The engine-facing edges of ownership/: which instance a read is about, whether its row carries
 * the whole declaration, what a resume note is worth without a shared bag or a proof, and that a
 * `settled` check that cannot run never fails the plan. whole.test.ts has the hole walk itself;
 * the families' end-to-end behaviour is pinned through the engine in openbao/adopt-*.test.ts.
 */
import { describe, expect, test } from 'bun:test';
import { AdoptPolicy, Unowned } from 'alchemy/AdoptPolicy';
import { Artifacts, makeScopedArtifacts } from 'alchemy/Artifacts';
import { InMemoryService } from 'alchemy/State/InMemoryState';
import type { ResourceState } from 'alchemy/State/ResourceState';
import { State } from 'alchemy/State/State';
import { Stack } from 'alchemy/Stack';
import * as Effect from 'effect/Effect';
import { refuseTakeover } from './adopt.ts';
import { ownedRead } from './probe.ts';
import { noteResume, noteUnfinished, resumes } from './resume.ts';
import { forgetRefusedCreate, isCreate, recordedInstance } from './rows.ts';

const row = (fqn: string, instanceId: string, old?: unknown, props: unknown = { name: 'a' }) =>
  ({
    fqn,
    instanceId,
    old,
    props,
    status: old === undefined ? 'creating' : 'replacing',
  }) as unknown as ResourceState;

/**
 * A stack `s` at stage `test` whose store holds `rows`: `A` and `B` declared with a `name`, and `Z`
 * declared `renamedFrom('X')`.
 */
const withStore = <A>(rows: Record<string, ResourceState>, effect: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      Effect.provideService(State, InMemoryService({ s: { test: rows } })),
      Effect.provideService(Stack, {
        actions: {},
        bindings: {},
        name: 's',
        resources: {
          A: { Props: { name: 'a' } },
          B: { Props: { name: 'b' } },
          Z: { FormerFqns: ['X'], Props: { name: 'a' } },
        },
        stage: 'test',
      } as never),
    ),
  );

describe('recordedInstance', () => {
  test('is the row at the FQN, any generation of its `old` chain, or a renamedFrom row', async () => {
    const rows = { A: row('A', 'new', row('A', 'older')), X: row('X', 'moved') };
    expect(await withStore(rows, recordedInstance('A', 'new'))).toBe('whole');
    expect(await withStore(rows, recordedInstance('A', 'older'))).toBe('whole');
    expect(await withStore(rows, recordedInstance('Z', 'moved'))).toBe('whole');
  });

  test("the probe's freshly minted instance is never recorded", async () => {
    expect(await withStore({ A: row('A', 'mine') }, recordedInstance('A', 'probe'))).toBe('absent');
    expect(await withStore({}, recordedInstance('A', 'mine'))).toBe('absent');
  });

  test('a row missing a declared prop (an Output stripped at commit) is partial', async () => {
    const holed = { A: row('A', 'mine', undefined, {}) };
    expect(await withStore(holed, recordedInstance('A', 'mine'))).toBe('partial');
    // ★ No longer declared (an orphan's delete): nothing to compare, so never whole.
    expect(await withStore({ C: row('C', 'mine') }, recordedInstance('C', 'mine'))).toBe('partial');
  });

  test('fails closed with no Stack or State in context', async () => {
    expect(await Effect.runPromise(recordedInstance('A', 'mine'))).toBe('absent');
  });
});

describe('isCreate', () => {
  test("is this instance's `creating` row — never a replace's `replacing` one", async () => {
    const rows = { A: row('A', 'mine'), B: row('B', 'new', row('B', 'older')) };
    expect(await withStore(rows, isCreate('A', 'mine'))).toBe(true);
    expect(await withStore(rows, isCreate('B', 'new'))).toBe(false);
    expect(await withStore(rows, isCreate('A', 'other'))).toBe(false);
    expect(await Effect.runPromise(isCreate('A', 'mine'))).toBe(false);
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

  test('the recovery read is ours only when settled, over a row with the whole declaration', async () => {
    expect(Unowned.is(await withStore(rows, ownedRead(ask(), found, Effect.succeed(true))))).toBe(
      false,
    );
    expect(Unowned.is(await withStore(rows, ownedRead(ask(), found, Effect.succeed(false))))).toBe(
      true,
    );
    const holed = { A: row('A', 'mine', undefined, {}) };
    expect(Unowned.is(await withStore(holed, ownedRead(ask(), found, Effect.succeed(true))))).toBe(
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

  const ours = Effect.succeed({ name: 'a' });

  test('a note is read back for its own instance only, and nothing is noted without a bag', async () => {
    await inBag(noteResume('mine', ours));
    expect(await inBag(resumes('mine'))).toBe(true);
    expect(await inBag(resumes('other'))).toBe(false);
    await Effect.runPromise(noteResume('mine', ours));
    expect(await Effect.runPromise(resumes('mine'))).toBe(false);
  });

  test('nothing is noted unless the read proves the object ours', async () => {
    const fresh = makeScopedArtifacts(new Map(), 'A');
    const unproven = [
      Effect.succeed(undefined),
      Effect.succeed(Unowned({ name: 'a' })),
      Effect.fail(new Error('403')),
      Effect.die(new TypeError('olds.name is undefined')),
    ];
    for (const read of unproven) {
      await Effect.runPromise(
        noteResume('mine', read).pipe(Effect.provideService(Artifacts, fresh)),
      );
    }
    expect(
      await Effect.runPromise(resumes('mine').pipe(Effect.provideService(Artifacts, fresh))),
    ).toBe(false);
  });

  test('refuses a create with no note and no adoption; state or a note lets it through', async () => {
    const owner = { fqn: 'A', instanceId: 'mine', output: undefined };
    await expect(Effect.runPromise(refuseTakeover(owner, 'Thing a'))).rejects.toThrow(
      /Thing a: already exists.*--adopt/s,
    );
    await Effect.runPromise(refuseTakeover({ ...owner, output: {} }, 'Thing a'));
    await inBag(noteResume('mine', ours));
    await inBag(refuseTakeover(owner, 'Thing a'));
  });

  test("--adopt covers a create or an unfinished generation, never a fresh replace's", async () => {
    const rows = { A: row('A', 'mine'), B: row('B', 'new', row('B', 'older')) };
    const adopting = <A>(effect: Effect.Effect<A>, bag = makeScopedArtifacts(new Map(), 'B')) =>
      withStore(
        rows,
        effect.pipe(
          Effect.provideService(AdoptPolicy, true),
          Effect.provideService(Artifacts, bag),
        ),
      );
    await adopting(refuseTakeover({ fqn: 'A', instanceId: 'mine', output: undefined }, 'Thing a'));
    const fresh = { fqn: 'B', instanceId: 'new', output: undefined };
    await expect(adopting(refuseTakeover(fresh, 'Thing b'))).rejects.toThrow(
      /Thing b: already exists.*new identity of a replace, which --adopt does not cover/s,
    );
    const seen = makeScopedArtifacts(new Map(), 'B');
    await adopting(noteUnfinished('new'), seen);
    await adopting(refuseTakeover(fresh, 'Thing b'), seen);
  });
});

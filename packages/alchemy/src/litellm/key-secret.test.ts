/**
 * `LiteLLM.Key`'s secret: where it may go and where it must not. Every value here is FAKE-*, so a
 * test can search for it — a secret nobody can find in a place proves nothing about that place.
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Redacted from 'effect/Redacted';
import { keyHandlers } from './key.ts';
import { generateKey } from './key-operations.ts';
import {
  FAKE_KEY,
  OTHER_FAKE_KEY,
  VAR,
  declare,
  failureOf,
  keyStack,
  liveRow,
  newFake,
  runAgainst,
  withEnv,
} from './key-harness.ts';

const seat = { key: { fromEnv: VAR }, keyAlias: 'seat-a' } as const;
const reconcile = (news: Parameters<typeof keyHandlers.reconcile>[0]['news']) =>
  keyHandlers.reconcile({ fqn: 'Seat', instanceId: 'i-1', news, output: undefined });

describe('create returns the key Redacted, and it goes nowhere else', () => {
  test("the SDK hands /key/generate's key back Redacted: it prints as <redacted>", async () => {
    const fake = newFake();
    const response = await runAgainst(fake, generateKey({ key: FAKE_KEY, key_alias: 'seat-a' }));
    expect(Redacted.isRedacted(response.key)).toBe(true);
    expect(String(response.key)).toBe('<redacted>');
    expect(JSON.stringify(response)).not.toContain(FAKE_KEY);
    expect(Redacted.value(response.key as Redacted.Redacted<string>)).toBe(FAKE_KEY);
  });

  test('the value reaches the proxy once and is in no state Alchemy persists', async () => {
    const fake = newFake();
    const stack = keyStack(fake);
    await withEnv({ [VAR]: FAKE_KEY }, () => stack.deploy(declare({ ...seat, models: ['m'] })));
    expect(fake.keys.received()).toEqual([FAKE_KEY]);
    expect(
      fake.keys.writes().filter((w) => JSON.stringify(w.body).includes(FAKE_KEY)),
    ).toHaveLength(1);
    const state = stack.snapshot();
    expect(state).not.toContain(FAKE_KEY);
    expect(state).toContain(VAR); // the NAME is what state keeps
    expect(state).not.toContain('FAKE-TOKEN'); // and neither is the row's hash
  });

  test('the attributes a create returns carry no key material at all', async () => {
    const fake = newFake();
    const attributes = await withEnv({ [VAR]: FAKE_KEY }, () => runAgainst(fake, reconcile(seat)));
    expect(Object.keys(attributes).sort()).toEqual([
      'allowedRoutes',
      'budgetId',
      'duration',
      'expires',
      'keyAlias',
      'metadata',
      'models',
      'teamId',
      'withheld',
    ]);
    expect(JSON.stringify(attributes)).not.toContain(FAKE_KEY);
  });
});

describe('a read-only plan never reveals or needs the key', () => {
  test('diff does not read the environment and makes no request', async () => {
    const fake = newFake();
    const attributes = await withEnv({ [VAR]: FAKE_KEY }, () => runAgainst(fake, reconcile(seat)));
    const before = fake.requests().length;
    const result = await withEnv({ NEVER_SET_FAKE_VAR: undefined }, () =>
      runAgainst(
        fake,
        keyHandlers.diff({
          news: { key: { fromEnv: 'NEVER_SET_FAKE_VAR' }, keyAlias: 'seat-a', models: ['x'] },
          output: attributes,
        }),
      ),
    );
    expect(result).toEqual({ action: 'update' });
    expect(fake.requests()).toHaveLength(before);
  });

  test('read surfaces no token hash, for an adopted row or a managed one', async () => {
    const fake = newFake({ keySeed: [liveRow({ models: ['m'] })] });
    const olds = { keyAlias: 'seat-a' };
    const adopted = await runAgainst(fake, keyHandlers.read({ olds, output: undefined }));
    expect(JSON.stringify(adopted)).not.toContain('FAKE-TOKEN');
    expect(JSON.stringify(adopted)).toContain('"models":["m"]');
  });
});

describe('a value that cannot be used is refused before any write', () => {
  const refused = async (env: string | undefined, props = seat) => {
    const fake = newFake();
    const failure = await failureOf(
      withEnv({ [VAR]: env }, () => keyStack(fake).deploy(declare(props))),
    );
    expect(fake.keys.writes()).toEqual([]);
    return failure;
  };

  test('an unset variable names the variable and the alias', async () => {
    const message = await refused(undefined);
    expect(message).toContain(VAR);
    expect(message).toContain('seat-a');
  });

  test('an EMPTY variable is a missing one, not an empty key', async () => {
    expect(await refused('')).toContain(VAR);
  });

  test('a value that breaks the /key/generate rule is refused, and the value is not repeated', async () => {
    for (const bad of ['sk-FAKE-short', 'FAKE-no-sk-prefix-0000000000']) {
      const message = await refused(bad);
      expect(message).toContain("must start with 'sk-'");
      expect(message).not.toContain(bad);
    }
  });

  test('the typed errors carry the variable and rule, never the value', async () => {
    const fake = newFake();
    const error = await withEnv({ [VAR]: 'sk-FAKE-short' }, () =>
      runAgainst(fake, Effect.flip(reconcile(seat))),
    );
    expect(error).toMatchObject({ _tag: 'LitellmKeyValueMalformedError', variable: VAR });
    expect(JSON.stringify(error)).not.toContain('sk-FAKE-short');
  });

  test('a create with no `key` declared is refused, not left to mint a value nobody holds', async () => {
    const fake = newFake();
    const error = await runAgainst(fake, Effect.flip(reconcile({ keyAlias: 'seat-a' })));
    expect(error).toMatchObject({ _tag: 'LitellmKeyValueRequiredError', keyAlias: 'seat-a' });
    expect(fake.keys.writes()).toEqual([]);
  });
});

describe('the value is only ever for a create', () => {
  test('an existing key is never sent one: the variable is not even read', async () => {
    const fake = newFake({ keySeed: [liveRow({ models: ['old'] })] });
    await withEnv({ [VAR]: OTHER_FAKE_KEY }, () =>
      keyStack(fake).deploy(declare({ ...seat, models: ['new'] }), { adopt: true }),
    );
    expect(fake.keys.received()).toEqual([]);
    expect(JSON.stringify(fake.keys.writes())).not.toContain(OTHER_FAKE_KEY);
  });

  test('a proxy that mints its own value instead is caught, and its row removed again', async () => {
    const fake = newFake({ keyIgnoresUserValue: true });
    const message = await failureOf(
      withEnv({ [VAR]: FAKE_KEY }, () => keyStack(fake).deploy(declare(seat))),
    );
    expect(message).toContain('different value');
    expect(message).toContain('deleted again');
    expect(message).not.toContain(FAKE_KEY);
    expect(fake.keys.rows()).toEqual([]);
    expect(fake.keys.writes().map((w) => w.path)).toEqual(['/key/generate', '/key/delete']);
  });
});

/**
 * Runs `body` with `console.error` captured. The SDK really does print bodies under
 * `DISTILLED_DEBUG_HTTP`; capturing keeps the suite quiet and lets a test say what was printed.
 */
const printedBy = async (body: () => Promise<unknown>): Promise<string> => {
  const printed: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => void printed.push(args.join(' '));
  try {
    await body();
  } catch {
    // the deploy's own failure is asserted by the caller, from what it left behind
  } finally {
    console.error = original;
  }
  return printed.join('\n');
};

describe('what could still leak the value, or lose the key', () => {
  test('DISTILLED_DEBUG_HTTP refuses a create: the SDK would print the key to stderr', async () => {
    const fake = newFake();
    let message = '';
    const printed = await printedBy(async () => {
      message = await failureOf(
        withEnv({ [VAR]: FAKE_KEY, DISTILLED_DEBUG_HTTP: '1' }, () =>
          keyStack(fake).deploy(declare(seat)),
        ),
      );
    });
    expect(message).toContain('DISTILLED_DEBUG_HTTP');
    expect(message).not.toContain(FAKE_KEY);
    expect(fake.keys.writes()).toEqual([]);
    expect(printed).not.toContain(FAKE_KEY);
  });

  test('DISTILLED_DEBUG_HTTP does not stop an update, which never carries the value', async () => {
    const fake = newFake({ keySeed: [liveRow({ models: ['old'] })] });
    const printed = await printedBy(() =>
      withEnv({ DISTILLED_DEBUG_HTTP: '1', [VAR]: FAKE_KEY }, () =>
        keyStack(fake).deploy(declare({ ...seat, models: ['new'] }), { adopt: true }),
      ),
    );
    expect(fake.keys.writes().map((w) => w.path)).toEqual(['/key/update']);
    expect(printed).toContain('/key/update'); // the printing path ran…
    expect(printed).not.toContain(FAKE_KEY); // …with no value in it
  });

  test('a value with a trailing newline is refused, not sent', async () => {
    const fake = newFake();
    const message = await failureOf(
      withEnv({ [VAR]: `${FAKE_KEY}\n` }, () => keyStack(fake).deploy(declare(seat))),
    );
    expect(message).toContain('no whitespace');
    expect(fake.keys.writes()).toEqual([]);
  });

  test('an empty alias is refused before any request', async () => {
    const fake = newFake();
    const message = await failureOf(keyStack(fake).deploy(declare({ keyAlias: ' ' })));
    expect(message).toContain('keyAlias is empty');
    expect(fake.requests()).toEqual([]);
  });
});

/**
 * `Pbs.NotificationTarget` through Alchemy's own Plan and Apply, over a PBS that remembers writes
 * (fake-pbs-notify.ts) — the write-only contract, end to end.
 *
 * ★ WHAT IS PINNED, AND WHERE A REGRESSION WOULD LEAK:
 *   - the secret, the password and a `fromEnv` header reach the WIRE and never the STATE STORE
 *     (the store is dumped as JSON and searched, raw and base64);
 *   - a rotated value is found by the seal and written, and ONLY its group is written;
 *   - a plan without the variables is presence-only: noop, not a guess;
 *   - a write that needs a missing variable fails by the variable's NAME, before any request;
 *   - adopting a webhook that already has secrets writes nothing.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import * as Layer from 'effect/Layer';
import { engineOver } from '../verify/fake-engine.ts';
import type { PbsTarget } from './credentials.ts';
import { fakeNotify } from './fake-pbs-notify.ts';
import { withoutBao } from './fake-pve.ts';
import {
  PbsNotificationTarget,
  type PbsNotificationTargetProps,
  PbsNotificationTargetProvider,
} from './pbs-notification-target.ts';
import { keyAndValue, unbase64 } from './pbs-notification-target-wire.ts';

const PBS: PbsTarget = { api: 'https://pbs.test:8007/api2/json', mount: 'pbs-test', scheme: 'pbs' };
const PATH = 'config/notifications/endpoints/webhook/alertmanager';
const FIRST = 'tok-1111-not-real';
const SECOND = 'tok-2222-not-real';
const HEADER = 'hdr-3333-not-real';

const hook = (over: Partial<PbsNotificationTargetProps> = {}) =>
  PbsNotificationTarget('alertmanager', {
    body: '[{"labels": {"alertname": "x"}}]',
    header: { 'Content-Type': 'application/json', 'X-Scope': { fromEnv: 'HF_TEST_HEADER' } },
    method: 'post',
    name: 'alertmanager',
    secret: { token: { fromEnv: 'HF_TEST_TOKEN' } },
    target: PBS,
    type: 'webhook',
    url: 'https://alertmanager.example.com/api/v2/alerts',
    ...over,
  });

const setEnv = (values: Record<string, string | undefined>) => {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

afterEach(() => setEnv({ HF_TEST_HEADER: undefined, HF_TEST_TOKEN: undefined }));

const engineFor = (fake: ReturnType<typeof fakeNotify>) =>
  engineOver(PbsNotificationTargetProvider().pipe(Layer.provideMerge(fake.layer)));

const leaks = (stored: string, values: readonly string[]) =>
  values.filter((v) => stored.includes(v) || stored.includes(Buffer.from(v).toString('base64')));

const verifyDiff = async (engine: ReturnType<typeof engineFor>, body = hook()) =>
  (await engine.verify(body, { all: true })).rows[0]?.diff;

describe('a webhook created with write-only values', () => {
  test('sends them, stores none of them, and plans noop again', async () => {
    setEnv({ HF_TEST_HEADER: HEADER, HF_TEST_TOKEN: FIRST });
    const fake = fakeNotify();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(hook());
      expect(leaks(engine.stored(), [FIRST, HEADER])).toEqual([]);
      expect(engine.stored()).toContain('HF_TEST_TOKEN');
      expect(await verifyDiff(engine)).toBe('noop');
      await engine.deploy(hook());
    });
    expect(fake.writes()).toEqual(['POST config/notifications/endpoints/webhook']);
    const held = (fake.secrets.get(PATH) ?? []).map(keyAndValue);
    expect(held.map((s) => [s.name, unbase64(s.value ?? '')])).toEqual([['token', FIRST]]);
  });

  test('a rotated secret is found by the seal and PUT alone — headers are not resent', async () => {
    setEnv({ HF_TEST_HEADER: HEADER, HF_TEST_TOKEN: FIRST });
    const fake = fakeNotify();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(hook());
      setEnv({ HF_TEST_TOKEN: SECOND });
      expect(await verifyDiff(engine)).toBe('update');
      await engine.deploy(hook());
      expect(leaks(engine.stored(), [FIRST, SECOND, HEADER])).toEqual([]);
      expect(await verifyDiff(engine)).toBe('noop');
    });
    const put = fake.calls.filter((call) => call.method === 'PUT');
    expect(put).toHaveLength(1);
    expect(put[0]?.pairs.map(([key]) => key)).toContain('secret');
    expect(put[0]?.pairs.map(([key]) => key)).not.toContain('header');
    expect(unbase64(keyAndValue(fake.secrets.get(PATH)?.[0] ?? '').value ?? '')).toBe(SECOND);
  });

  test('a header changed on the server is drift, found by digest, repaired from the env', async () => {
    setEnv({ HF_TEST_HEADER: HEADER, HF_TEST_TOKEN: FIRST });
    const fake = fakeNotify();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(hook());
      const object = fake.objects.get(PATH) ?? {};
      const edited = `name=X-Scope,value=${Buffer.from('edited-by-hand').toString('base64')}`;
      fake.objects.set(PATH, { ...object, header: [(object['header'] as string[])[0], edited] });
      expect(await verifyDiff(engine)).toBe('update');
      await engine.deploy(hook());
      expect(leaks(engine.stored(), [HEADER, 'edited-by-hand'])).toEqual([]);
    });
    const put = fake.calls.find((call) => call.method === 'PUT');
    expect(put?.pairs.map(([key]) => key)).toContain('header');
    expect(put?.pairs.map(([key]) => key)).not.toContain('secret');
  });
});

describe('without the variables', () => {
  test('a plan is presence-only: noop, and a deploy writes nothing', async () => {
    setEnv({ HF_TEST_HEADER: HEADER, HF_TEST_TOKEN: FIRST });
    const fake = fakeNotify();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(hook());
      setEnv({ HF_TEST_HEADER: undefined, HF_TEST_TOKEN: undefined });
      expect(await verifyDiff(engine)).toBe('noop');
      await engine.deploy(hook());
    });
    expect(fake.writes()).toEqual(['POST config/notifications/endpoints/webhook']);
  });

  test('a comment change is still written — without the write-only groups, which the server keeps', async () => {
    setEnv({ HF_TEST_HEADER: HEADER, HF_TEST_TOKEN: FIRST });
    const fake = fakeNotify();
    await withoutBao(async () => {
      const engine = engineFor(fake);
      await engine.deploy(hook());
      setEnv({ HF_TEST_HEADER: undefined, HF_TEST_TOKEN: undefined });
      await engine.deploy(hook({ comment: 'pager' }));
    });
    const put = fake.calls.find((call) => call.method === 'PUT');
    expect(put?.pairs.map(([key]) => key).sort()).toEqual([
      'body',
      'comment',
      'disable',
      'method',
      'url',
    ]);
    expect(unbase64(keyAndValue(fake.secrets.get(PATH)?.[0] ?? '').value ?? '')).toBe(FIRST);
  });

  test('a write that needs a missing value fails by variable name, before any request', async () => {
    const fake = fakeNotify();
    let failure = '';
    await withoutBao(async () => {
      await engineFor(fake)
        .deploy(hook())
        .catch((error: unknown) => {
          failure = String(error);
        });
    });
    expect(failure).toContain('HF_TEST_HEADER, HF_TEST_TOKEN');
    expect(fake.writes()).toEqual([]);
  });
});

describe('adopting a webhook that already holds secrets', () => {
  test('reads only: names match, values are unknown, nothing is written', async () => {
    setEnv({ HF_TEST_HEADER: HEADER, HF_TEST_TOKEN: FIRST });
    const fake = fakeNotify({
      [PATH]: {
        body: Buffer.from('[{"labels": {"alertname": "x"}}]').toString('base64'),
        header: [
          `name=Content-Type,value=${Buffer.from('application/json').toString('base64')}`,
          `name=X-Scope,value=${Buffer.from(HEADER).toString('base64')}`,
        ],
        method: 'post',
        name: 'alertmanager',
        url: 'https://alertmanager.example.com/api/v2/alerts',
      },
    });
    fake.secrets.set(PATH, [`name=token,value=${Buffer.from('set-by-hand').toString('base64')}`]);
    await withoutBao(async () => {
      const engine = engineFor(fake);
      expect((await engine.verify(hook())).rows[0]).toMatchObject({ diff: 'noop', ok: true });
      await engine.deploy(hook());
      expect(leaks(engine.stored(), [HEADER, 'set-by-hand', FIRST])).toEqual([]);
    });
    expect(fake.writes()).toEqual([]);
  });
});

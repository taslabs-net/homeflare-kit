/**
 * Pins the two Opus findings on the CephFlag transport (kit PR 319, 2026-09-28).
 *
 * 1. A `{"data":null}` body becomes `{}` inside distilled's `transformResponse` before the
 *    provider sees it. Guarding only `null`/`undefined` lets `bool({})` read a missing answer
 *    as "flag clear".
 * 2. A refused mint must not fail `diff`. Alchemy fails the whole plan if one resource's
 *    `diff` fails (unreadable-read.ts).
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { engineOver } from '../verify/fake-engine.ts';
import { scalarFlagOrDie } from './ceph-flag-wire.ts';
import { ProxmoxCephFlag, ProxmoxCephFlagProvider } from './ceph-flag.ts';
import { FAKE_TARGET, withoutBao } from './fake-pve.ts';

const flagProps = { flag: 'noout' as const, target: FAKE_TARGET, value: true };

describe('CephFlag GET of no data dies instead of reading clear', () => {
  test('the post-transform empty object dies', async () => {
    // distilled protocol.ts maps `{"data":null}` to `{}` before a RawResponseRoot decode.
    await expect(Effect.runPromise(scalarFlagOrDie({}, flagProps))).rejects.toThrow(
      /not a bare boolean/,
    );
    await expect(Effect.runPromise(scalarFlagOrDie(null, flagProps))).rejects.toThrow(
      /not a bare boolean/,
    );
  });

  test('a real scalar still decodes', async () => {
    expect(await Effect.runPromise(scalarFlagOrDie(1, flagProps))).toBe(1);
    expect(await Effect.runPromise(scalarFlagOrDie(false, flagProps))).toBe(false);
  });
});

describe('a refused CephFlag read does not abort the plan', () => {
  test('verify after a 403 mint reports noop, not a failed plan', async () => {
    let refuse = false;
    const stub = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const request =
        input instanceof Request ? new Request(input, init) : new Request(String(input), init);
      const url = new URL(request.url);
      if (url.pathname.includes('/creds/')) {
        if (refuse) {
          return Response.json({ errors: ['status 403'] }, { status: 403 });
        }
        return Response.json({
          data: { secret: 'fake-secret-not-real', token_id: 'hf-test@pve!fake' },
          lease_duration: 0,
        });
      }
      return Response.json({ data: 1 });
    };
    const layer = FetchHttpClient.layer.pipe(
      Layer.provideMerge(
        Layer.succeed(
          FetchHttpClient.Fetch,
          Object.assign(stub, { preconnect: globalThis.fetch.preconnect }) as typeof fetch,
        ),
      ),
    );
    const declare = () => ProxmoxCephFlag('noout', flagProps);
    await withoutBao(async () => {
      const engine = engineOver(ProxmoxCephFlagProvider().pipe(Layer.provideMerge(layer)));
      expect(await engine.deploy(declare())).toEqual({ noout: 'adopted' });
      refuse = true;
      await expect(engine.verify(declare(), { all: true })).resolves.toBeDefined();
    });
  });
});

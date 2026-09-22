/**
 * The provider's plan-time refusals, through the engine-facing handlers (fake-provider.ts): each
 * with zero requests and zero writes. (A version outside a catalog never reaches a handler: it
 * fails in the stack program — catalog.test.ts, plan.test.ts.)
 */
import { describe, expect, test } from 'bun:test';
import * as Effect from 'effect/Effect';
import type { ReleaseBinaryProps } from './binary-form.ts';
import { VMUTILS_DIR } from './fake-release.ts';
import { call, harness, ids, must } from './fake-provider.ts';

describe('plan-time refusals: zero requests, zero writes', () => {
  test('the adoption probe refuses a malformed pin before touching the host', async () => {
    const h = harness();
    const next = { ...h.VMALERT, sha256: 'v1.151.0' };
    const probe = h.run((p) => must(p.read)({ ...ids, olds: next as never, output: undefined }));
    await expect(probe).rejects.toThrow('sha256 must be 64 lower-case hex digits');
    expect(h.requests).toEqual([]);
    expect(h.fake.calls).toEqual([]);
  });

  test('diff refuses a pin that is not a plain value, even while the directory is an Output', async () => {
    const h = harness();
    const output = await h.run((p) => h.reconcile(p, h.VMALERT));
    h.requests.length = 0;
    // ⛔ A pin computed during the deploy is a fetch by another name.
    const pending = {
      ...h.VMALERT,
      directory: Effect.succeed(VMUTILS_DIR),
      sha256: Effect.succeed(h.VMALERT.sha256),
    };
    const diff = h.run((p) =>
      must(p.diff)({ ...ids, ...call, news: pending as never, olds: h.VMALERT as never, output }),
    );
    await expect(diff).rejects.toThrow('sha256 is required, as a plain string');
    expect(h.requests).toEqual([]);
  });

  test('diff refuses a new pin at the same path', async () => {
    const h = harness();
    const output = await h.run((p) => h.reconcile(p, h.VMALERT));
    const bumped: ReleaseBinaryProps = { ...h.VMALERT, sha256: 'e'.repeat(64) };
    const diff = h.run((p) =>
      must(p.diff)({ ...ids, ...call, news: bumped as never, olds: h.VMALERT as never, output }),
    );
    await expect(diff).rejects.toThrow('would overwrite it in place');
  });
});

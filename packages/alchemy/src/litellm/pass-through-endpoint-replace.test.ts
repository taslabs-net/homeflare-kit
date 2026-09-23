/**
 * `LiteLLM.PassThroughEndpoint`'s `replace` (clearing `timeout`/`methods`/`guardrails`), through
 * Alchemy's own `Plan.make`/`apply` (fake-stack.ts) — not the handlers called directly.
 *
 * ⛔ BUG: before this file's fix, `diff` answered `{ action: 'replace' }` with no `deleteFirst`.
 *   Per `Apply.ts`, that is CREATE-FIRST: the engine mints a fresh `instanceId` and calls
 *   `reconcile` for the new generation with `output: undefined, olds: undefined`, deleting the old
 *   generation only afterwards, by a SEPARATE `provider.delete()` call under the OLD instanceId.
 *   Since `objectId` is derived from `instanceId` (`physicalIdOf`/`createPhysicalName`), the new
 *   generation's id differs from the still-live old row on the same `path`. `reconcile`'s own
 *   `locate()` then finds that old row as a `conflict` on `path` (not `mine`, since the id differs)
 *   and refuses with `LitellmUnaddressableRowError` — misidentifying its own prior generation as a
 *   foreign, unaddressable row. Every real deploy that clears one of the three nullable fields
 *   failed outright. `pass-through-endpoint.test.ts`'s own 'clearing a nullable field' test never
 *   caught this: it calls `h.reconcile` directly with the SAME instanceId and the OLD output, a
 *   call shape the real engine never produces for a `replace`.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import { type FakeStack, fakeStack, writesOf } from './fake-stack.ts';
import { type FakeLitellm, startFakeLitellm } from './fake-litellm.ts';
import { LiteLLMPassThroughEndpoint } from './pass-through-endpoint.ts';
import type { PassThroughEndpointProps } from './pass-through-form.ts';

const MASTER_KEY = 'sk-test-master';

let fake: FakeLitellm;
let stack: FakeStack;
beforeEach(() => {
  fake = startFakeLitellm({ masterKey: MASTER_KEY });
  stack = fakeStack({ apiKey: MASTER_KEY, baseUrl: fake.url });
});
afterEach(() => fake.stop());

/** ★ `RemovalPolicy.destroy()`, deliberately: under the (non-default) `retain`, `deleteFirst`'s own
 *   old-generation delete is skipped by the engine (Apply.ts's `deleteOldGenerations`), so a path
 *   that cannot hold two rows stays conflicted either way — a documented engine limitation
 *   (openbao/REPLACE.md), not this provider's bug, and out of scope for this fix. */
const declare = (props: PassThroughEndpointProps) =>
  Effect.asVoid(LiteLLMPassThroughEndpoint('Endpoint', props).pipe(RemovalPolicy.destroy()));

describe('clearing a nullable field, through the engine', () => {
  test('plans replace and leaves exactly one live row on the path, never two, never zero', async () => {
    const withTimeout: PassThroughEndpointProps = {
      path: '/bria',
      target: 'https://api.bria.ai',
      timeout: 30,
    };
    const cleared: PassThroughEndpointProps = { path: '/bria', target: 'https://api.bria.ai' };

    expect(await stack.deploy(declare(withTimeout))).toEqual({ Endpoint: 'create' });
    const oldId = fake.rows().find((r) => r.path === '/bria')?.id;
    expect(oldId).toBeDefined();

    const planned = await stack.deploy(declare(cleared));

    expect(planned).toEqual({ Endpoint: 'replace' });
    const onPath = fake.rows().filter((r) => r.path === '/bria');
    expect(onPath).toHaveLength(1);
    expect(onPath[0]?.timeout).toBeUndefined();
    // ★ deleteFirst: the old generation's id is gone; the surviving row is a NEW generation, not
    //   the old row merely left with a stale `timeout` because the write silently no-op'd.
    expect(onPath[0]?.id).not.toBe(oldId);
  });

  test('deletes the old generation before creating the new one on the same path', async () => {
    const withTimeout: PassThroughEndpointProps = {
      path: '/bria',
      target: 'https://api.bria.ai',
      timeout: 30,
    };
    const cleared: PassThroughEndpointProps = { path: '/bria', target: 'https://api.bria.ai' };
    await stack.deploy(declare(withTimeout));
    const before = fake.requests().length;

    await stack.deploy(declare(cleared));

    const writes = writesOf(fake.requests().slice(before));
    // create-first would be [POST, DELETE]; a `path` that cannot hold two rows needs delete-first.
    expect(writes[0]?.startsWith('DELETE')).toBe(true);
    expect(writes.some((w) => w.startsWith('POST /config/pass_through_endpoint'))).toBe(true);
  });
});

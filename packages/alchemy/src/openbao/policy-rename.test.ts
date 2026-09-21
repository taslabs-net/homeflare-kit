/**
 * Renaming a Bao.Policy, through Alchemy's own plan and apply (fake-stack.ts) against a fake policy
 * store keyed as OpenBao keys it (fake-engines.ts). Before 2026-09-21 the second deploy of every
 * rename below planned `update` and left the old policy live, under `destroy` too.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Output from 'alchemy/Output';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import type { Fake } from './fake-bao.ts';
import { aclPolicies, fakePolicyProviders } from './fake-engines.ts';
import { type FakeStack, type StackBody, withFakeStack, writesOf as writes } from './fake-stack.ts';
import { BaoPolicy } from './policy.ts';

/** A fake policy store and a stack over it; `live` lists the policy names the store holds. */
const withStack = (body: (stack: FakeStack, bao: Fake, live: () => string[]) => Promise<void>) => {
  const store = aclPolicies();
  return withFakeStack(fakePolicyProviders, store, (stack, bao) =>
    body(stack, bao, () =>
      [...store.live.keys()].map((path) => path.replace('sys/policies/acl/', '')).sort(),
    ),
  );
};

type Removal = typeof RemovalPolicy.destroy;
const policy = (name: string, removal: Removal = RemovalPolicy.retain): StackBody =>
  Effect.asVoid(BaoPolicy('Policy', { fragments: '/policies/app', name }).pipe(removal()));

describe('Bao.Policy rename, through the engine', () => {
  it('plans replace, writes the new name first, then deletes the OLD name under destroy', async () => {
    await withStack(async (stack, bao, live) => {
      assert.deepEqual(await stack.deploy(policy('app-old', RemovalPolicy.destroy)), {
        Policy: 'create',
      });
      bao.seen.length = 0;
      assert.deepEqual(await stack.deploy(policy('app-new', RemovalPolicy.destroy)), {
        Policy: 'replace',
      });
      assert.deepEqual(writes(bao.seen), [
        'PUT /v1/sys/policies/acl/app-new',
        'DELETE /v1/sys/policies/acl/app-old',
      ]);
      assert.deepEqual(live(), ['app-new']);
    });
  });

  it('still plans replace under the default retain, and keeps the old policy live', async () => {
    await withStack(async (stack, bao, live) => {
      await stack.deploy(policy('app-old'));
      assert.deepEqual(await stack.deploy(policy('app-new')), { Policy: 'replace' });
      assert.ok(!writes(bao.seen).some((each) => each.startsWith('DELETE')));
      assert.deepEqual(live(), ['app-new', 'app-old']);
    });
  });

  it('treats a change of case as the same policy: noop, and nothing deleted', async () => {
    await withStack(async (stack, bao, live) => {
      await stack.deploy(policy('App', RemovalPolicy.destroy));
      bao.seen.length = 0;
      assert.deepEqual(await stack.deploy(policy('app', RemovalPolicy.destroy)), {
        Policy: 'noop',
      });
      assert.deepEqual(writes(bao.seen), []);
      assert.deepEqual(live(), ['app']);
    });
  });

  it('plans replace while `fragments` is still an Output of a changing upstream', async () => {
    const body = (dir: string, name: string): StackBody =>
      Effect.gen(function* () {
        const upstream = yield* BaoPolicy('Upstream', { fragments: dir, name: 'upstream' });
        yield* BaoPolicy('Policy', {
          fragments: Output.interpolate`/policies/${upstream.grants}`,
          name,
        }).pipe(RemovalPolicy.destroy());
      });
    await withStack(async (stack, _bao, live) => {
      await stack.deploy(body('/policies/one', 'app-old'));
      const planned = await stack.deploy(body('/policies/two', 'app-new'));
      assert.deepEqual(planned, { Policy: 'replace', Upstream: 'update' });
      assert.deepEqual(live(), ['app-new', 'upstream']);
    });
  });

  it('refuses an update across a rename it could not see, then replaces on the next deploy', async () => {
    // ★ The name is an Output of an upstream that is updating, so the diff cannot see it at plan.
    const body = (dir: string): StackBody =>
      Effect.gen(function* () {
        const upstream = yield* BaoPolicy('Upstream', { fragments: dir, name: 'upstream' });
        yield* BaoPolicy('Policy', {
          fragments: '/policies/app',
          name: Output.interpolate`app-${upstream.grants}`,
        }).pipe(RemovalPolicy.destroy());
      });
    await withStack(async (stack, bao, live) => {
      await stack.deploy(body('/policies/one'));
      assert.deepEqual(live(), ['app-1', 'upstream']);
      bao.seen.length = 0;
      await assert.rejects(
        stack.deploy(body('/policies/two')),
        /identity moved from app-1 to app-2/,
      );
      assert.deepEqual(writes(bao.seen), ['PUT /v1/sys/policies/acl/upstream']);
      assert.deepEqual(await stack.deploy(body('/policies/two')), {
        Policy: 'replace',
        Upstream: 'noop',
      });
      assert.deepEqual(live(), ['app-2', 'upstream']);
    });
  });
});

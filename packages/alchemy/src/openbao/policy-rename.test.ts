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
import * as FileSystem from 'effect/FileSystem';
import * as Layer from 'effect/Layer';
import * as Path from 'effect/Path';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { type Fake, type Seen, fakeBao } from './fake-bao.ts';
import { aclPolicies } from './fake-engines.ts';
import { type StackBody, fakeStack } from './fake-stack.ts';
import { BaoPolicy, BaoPolicyProvider } from './policy.ts';

/** One grant per fragment file, named after its path, so a directory's content is its name. */
const files = Layer.mergeAll(
  FileSystem.layerNoop({
    readDirectory: (dir) => Effect.succeed(dir.endsWith('/two') ? ['a.hcl', 'b.hcl'] : ['a.hcl']),
    readFileString: (path) => Effect.succeed(`path "${path}" {\n  capabilities = ["read"]\n}`),
  }),
  Path.layer,
);
const providers = Layer.mergeAll(
  BaoPolicyProvider().pipe(Layer.provide(files)),
  FetchHttpClient.layer,
);

/** A fake policy store and a stack over it; `body` runs inside, and the fake stops after. */
const withStack = async (
  body: (stack: ReturnType<typeof fakeStack>, bao: Fake, live: () => string[]) => Promise<void>,
) => {
  const store = aclPolicies();
  const bao = fakeBao(store);
  try {
    await body(fakeStack(providers, { BAO_ADDR: bao.address }), bao, () =>
      [...store.live.keys()].map((path) => path.replace('sys/policies/acl/', '')).sort(),
    );
  } finally {
    bao.stop();
  }
};

type Removal = typeof RemovalPolicy.destroy;
const policy = (name: string, removal: Removal = RemovalPolicy.retain): StackBody =>
  Effect.asVoid(BaoPolicy('Policy', { fragments: '/policies/app', name }).pipe(removal()));

const writes = (seen: Seen[]) =>
  seen.filter((each) => each.method !== 'GET').map((each) => `${each.method} ${each.path}`);

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

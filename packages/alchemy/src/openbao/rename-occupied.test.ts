/**
 * A move onto an object that already exists, through Alchemy's own plan and apply (fake-stack.ts).
 * Before `judgeMove` read the target, the first test below was a GREEN deploy that deleted both
 * policies: each new generation wrote over the other's, and each old generation's delete then
 * removed what the other had just written (rename.ts has the measurement).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as Output from 'alchemy/Output';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { groupKey } from './cloudflare-group-scope.ts';
import { CloudflarePermissionGroups } from './cloudflare-permission-groups.ts';
import { BaoCloudflareRole, BaoCloudflareRoleProvider } from './cloudflare-role.ts';
import { aclPolicies, cloudflareRoles, fakePolicyProviders, proxmoxRoles } from './fake-engines.ts';
import { type StackBody, withFakeStack, writesOf } from './fake-stack.ts';
import { BaoPolicy } from './policy.ts';
import { BaoProxmoxRole, BaoProxmoxRoleProvider } from './proxmox-role.ts';

const OCCUPIED = /would land on an object that already exists/;

/** Two policies, `X` and `Y`, each with fragments named after its logical id, under destroy. */
const pair = (x: string, y: string): StackBody =>
  Effect.gen(function* () {
    yield* BaoPolicy('X', { fragments: '/p/x', name: x }).pipe(RemovalPolicy.destroy());
    yield* BaoPolicy('Y', { fragments: '/p/y', name: y }).pipe(RemovalPolicy.destroy());
  });

describe('Bao.Policy: a rename onto a policy that exists fails the plan', () => {
  it('a swap under destroy writes nothing and deletes nothing', async () => {
    const store = aclPolicies();
    await withFakeStack(fakePolicyProviders, store, async (stack, bao) => {
      await stack.deploy(pair('a', 'b'));
      const before = new Map(store.live);
      bao.seen.length = 0;
      await assert.rejects(stack.deploy(pair('b', 'a')), OCCUPIED);
      assert.deepEqual(writesOf(bao.seen), []);
      assert.deepEqual(store.live, before);
    });
  });

  it('a shift (a → b while b → c) is refused for the name still held', async () => {
    const store = aclPolicies();
    await withFakeStack(fakePolicyProviders, store, async (stack, bao) => {
      await stack.deploy(pair('a', 'b'));
      bao.seen.length = 0;
      await assert.rejects(stack.deploy(pair('b', 'c')), /Bao\.Policy: a → b would land/);
      assert.deepEqual(writesOf(bao.seen), []);
    });
  });

  it('reverting a move whose new generation failed is refused while the old name is live', async () => {
    const store = aclPolicies();
    const one = (name: string, dir: string): StackBody =>
      Effect.asVoid(BaoPolicy('X', { fragments: dir, name }).pipe(RemovalPolicy.destroy()));
    await withFakeStack(fakePolicyProviders, store, async (stack, bao) => {
      await stack.deploy(one('a', '/p/x'));
      await assert.rejects(stack.deploy(one('b', '/p/empty')), /carry no path grant/);
      bao.seen.length = 0;
      await assert.rejects(stack.deploy(one('a', '/p/x')), /Bao\.Policy: b → a would land/);
      assert.deepEqual(writesOf(bao.seen), []);
      assert.ok(store.live.has('sys/policies/acl/a'));
      // ★ Finishing the move instead replaces cleanly and deletes the old name.
      assert.deepEqual(await stack.deploy(one('b', '/p/x')), { X: 'replace' });
      assert.deepEqual([...store.live.keys()], ['sys/policies/acl/b']);
    });
  });
});

/** Every group resolves, to an id named after it. */
const groups = Layer.succeed(CloudflarePermissionGroups, {
  resolve: (_mount, refs) =>
    Effect.succeed(new Map(refs.map((ref) => [groupKey(ref.name, ref.scope), `id-${ref.name}`]))),
});
const roleProviders = Layer.mergeAll(
  BaoCloudflareRoleProvider().pipe(Layer.provide(groups)),
  BaoProxmoxRoleProvider(),
  FetchHttpClient.layer,
);

const cf = (id: string, name: string) =>
  BaoCloudflareRole(id, {
    description: 'Read DNS records on one zone. (zone: example.com)',
    maxTtl: '1h',
    mount: 'cloudflare-example',
    name,
    policies: [
      {
        effect: 'allow',
        groupOrder: 'declared',
        groups: ['DNS Read'],
        resource: 'com.cloudflare.api.account.zone.z1',
      },
    ],
    ttl: '5m',
  }).pipe(RemovalPolicy.destroy());

describe('the role families: a move onto a role that exists fails the plan', () => {
  it('Bao.CloudflareRole: a swap under destroy writes nothing', async () => {
    const store = cloudflareRoles();
    const body = (x: string, y: string): StackBody =>
      Effect.gen(function* () {
        yield* cf('X', x);
        yield* cf('Y', y);
      });
    await withFakeStack(roleProviders, store, async (stack, bao) => {
      await stack.deploy(body('dns-read', 'dns-edit'));
      bao.seen.length = 0;
      await assert.rejects(stack.deploy(body('dns-edit', 'dns-read')), OCCUPIED);
      assert.deepEqual(writesOf(bao.seen), []);
      assert.equal(store.live.size, 2);
    });
  });

  it('Bao.ProxmoxRole: a rename onto a role made by hand writes nothing', async () => {
    const store = proxmoxRoles();
    const role = (name: string): StackBody =>
      Effect.asVoid(
        BaoProxmoxRole('Role', {
          maxTtl: '6h',
          mintUser: 'reader@pve',
          mount: 'proxmox-lab',
          name,
          ttl: '1h',
        }),
      );
    await withFakeStack(roleProviders, store, async (stack, bao) => {
      await stack.deploy(role('read'));
      store.live.set('proxmox-lab/roles/audit', { max_ttl: 0, mint_user: 'auditor@pve', ttl: 0 });
      bao.seen.length = 0;
      await assert.rejects(stack.deploy(role('audit')), OCCUPIED);
      assert.deepEqual(writesOf(bao.seen), []);
      assert.equal(store.live.get('proxmox-lab/roles/audit')?.['mint_user'], 'auditor@pve');
    });
  });
});

describe('Bao.ProxmoxRole: a re-scoping rename whose allowance is still an Output', () => {
  it('defers instead of refusing a value it cannot read yet, then checks it once resolved', async () => {
    const store = proxmoxRoles();
    const base = { maxTtl: '6h', mount: 'proxmox-lab', ttl: '1h' } as const;
    const body = (ttl: string, name: string, mintUser: string): StackBody =>
      Effect.gen(function* () {
        const up = yield* BaoProxmoxRole('Upstream', {
          ...base,
          mintUser: 'up@pve',
          name: 'up',
          ttl,
        });
        const allowMintUserChange = Output.interpolate`reader-${up.ttl}@pve`;
        yield* BaoProxmoxRole('Role', { ...base, allowMintUserChange, mintUser, name });
      });
    await withFakeStack(roleProviders, store, async (stack) => {
      await stack.deploy(body('1h', 'read', 'reader@pve'));
      // ★ Before the defer, this died at plan asking for the allowance it had been given.
      await assert.rejects(stack.deploy(body('2h', 'reader', 'writer@pve')), /identity moved/);
      await assert.rejects(
        stack.deploy(body('2h', 'reader', 'writer@pve')),
        /the rename re-scopes mint_user reader@pve/,
      );
      assert.ok(!store.live.has('proxmox-lab/roles/reader'));
    });
  });
});

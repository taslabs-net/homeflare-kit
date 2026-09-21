/**
 * Moving a Bao.CloudflareRole or a Bao.ProxmoxRole to a new `mount` or `name`, through Alchemy's own
 * plan and apply (fake-stack.ts) against fakes of each engine's role store (fake-engines.ts). Before
 * 2026-09-21 every move below planned `update` and left the old role minting.
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
import type { BaoCloudflareRoleProps } from './cloudflare-role-form.ts';
import type { Seen } from './fake-bao.ts';
import { type Store, cloudflareRoles, proxmoxRoles } from './fake-engines.ts';
import { type StackBody, withFakeStack, writesOf as writes } from './fake-stack.ts';
import { BaoProxmoxRole, BaoProxmoxRoleProvider } from './proxmox-role.ts';
import type { BaoProxmoxRoleProps } from './proxmox-role-form.ts';

/** Every group resolves, to an id named after it — this file is about paths, not groups. */
const groups = Layer.succeed(CloudflarePermissionGroups, {
  resolve: (_mount, refs) =>
    Effect.succeed(new Map(refs.map((ref) => [groupKey(ref.name, ref.scope), `id-${ref.name}`]))),
});
const providers = Layer.mergeAll(
  BaoCloudflareRoleProvider().pipe(Layer.provide(groups)),
  BaoProxmoxRoleProvider(),
  FetchHttpClient.layer,
);

type Removal = typeof RemovalPolicy.destroy;

const withStack = (
  store: Store,
  body: (deploy: (body: StackBody) => Promise<unknown>, seen: Seen[]) => Promise<void>,
) => withFakeStack(providers, store, (stack, bao) => body(stack.deploy, bao.seen));

const livePaths = (store: Store) => [...store.live.keys()].sort();

const CF: BaoCloudflareRoleProps = {
  description: 'Read DNS records on one zone. (zone: example.com)',
  maxTtl: '1h',
  mount: 'cloudflare-acme-dns',
  name: 'example-com-dns-read',
  policies: [
    {
      effect: 'allow',
      groupOrder: 'declared',
      groups: ['DNS Read'],
      resource: 'com.cloudflare.api.account.zone.z1',
    },
  ],
  ttl: '5m',
};
const cf = (props: Partial<BaoCloudflareRoleProps>, removal: Removal = RemovalPolicy.retain) =>
  Effect.asVoid(BaoCloudflareRole('Role', { ...CF, ...props }).pipe(removal()));

describe('Bao.CloudflareRole move, through the engine', () => {
  it('a new name plans replace and deletes the OLD path under destroy', async () => {
    const store = cloudflareRoles();
    await withStack(store, async (deploy, seen) => {
      await deploy(cf({}, RemovalPolicy.destroy));
      seen.length = 0;
      assert.deepEqual(await deploy(cf({ name: 'example-com-dns-edit' }, RemovalPolicy.destroy)), {
        Role: 'replace',
      });
      assert.deepEqual(writes(seen), [
        'PUT /v1/cloudflare-acme-dns/roles/example-com-dns-edit',
        'DELETE /v1/cloudflare-acme-dns/roles/example-com-dns-read',
      ]);
      assert.deepEqual(livePaths(store), ['cloudflare-acme-dns/roles/example-com-dns-edit']);
    });
  });

  it('a new mount plans replace, and the default retain keeps the old role live', async () => {
    const store = cloudflareRoles();
    await withStack(store, async (deploy, seen) => {
      await deploy(cf({}));
      assert.deepEqual(await deploy(cf({ mount: 'cloudflare-other-dns' })), { Role: 'replace' });
      assert.ok(!writes(seen).some((each) => each.startsWith('DELETE')));
      assert.deepEqual(livePaths(store), [
        'cloudflare-acme-dns/roles/example-com-dns-read',
        'cloudflare-other-dns/roles/example-com-dns-read',
      ]);
    });
  });

  it('a trailing slash on the mount is the same path: noop, nothing deleted', async () => {
    const store = cloudflareRoles();
    await withStack(store, async (deploy, seen) => {
      await deploy(cf({}, RemovalPolicy.destroy));
      seen.length = 0;
      const planned = await deploy(cf({ mount: 'cloudflare-acme-dns/' }, RemovalPolicy.destroy));
      assert.deepEqual(planned, { Role: 'noop' });
      assert.deepEqual(writes(seen), []);
    });
  });
});

const PVE: BaoProxmoxRoleProps = {
  maxTtl: '6h',
  mintUser: 'reader@pve',
  mount: 'proxmox-lab',
  name: 'read',
  ttl: '1h',
};
const pve = (props: Partial<BaoProxmoxRoleProps>, removal: Removal = RemovalPolicy.retain) =>
  Effect.asVoid(BaoProxmoxRole('Role', { ...PVE, ...props }).pipe(removal()));

describe('Bao.ProxmoxRole move, through the engine', () => {
  it('a new name plans replace and deletes the OLD path under destroy', async () => {
    const store = proxmoxRoles();
    await withStack(store, async (deploy, seen) => {
      await deploy(pve({}, RemovalPolicy.destroy));
      seen.length = 0;
      assert.deepEqual(await deploy(pve({ name: 'reader' }, RemovalPolicy.destroy)), {
        Role: 'replace',
      });
      assert.deepEqual(writes(seen), [
        'PUT /v1/proxmox-lab/roles/reader',
        'DELETE /v1/proxmox-lab/roles/read',
      ]);
      assert.deepEqual(livePaths(store), ['proxmox-lab/roles/reader']);
    });
  });

  it('refuses a rename that also re-scopes mint_user, at plan, before any write', async () => {
    const store = proxmoxRoles();
    await withStack(store, async (deploy, seen) => {
      await deploy(pve({}));
      seen.length = 0;
      const moved = pve({ mintUser: 'provisioner@pve', name: 'provision' });
      await assert.rejects(deploy(moved), /allowMintUserChange: 'reader@pve'/);
      assert.deepEqual(writes(seen), []);
      assert.deepEqual(livePaths(store), ['proxmox-lab/roles/read']);
    });
  });

  it('lets the re-scoping rename through when it names the mint user it replaces', async () => {
    const store = proxmoxRoles();
    await withStack(store, async (deploy) => {
      await deploy(pve({}));
      const allowed = pve({
        allowMintUserChange: 'reader@pve',
        mintUser: 'provisioner@pve',
        name: 'provision',
      });
      assert.deepEqual(await deploy(allowed), { Role: 'replace' });
      assert.equal(store.live.get('proxmox-lab/roles/provision')?.['mint_user'], 'provisioner@pve');
    });
  });

  it('keeps a same-path mint_user change an update, refused at apply as before', async () => {
    const store = proxmoxRoles();
    await withStack(store, async (deploy, seen) => {
      await deploy(pve({}));
      seen.length = 0;
      await assert.rejects(deploy(pve({ mintUser: 'provisioner@pve' })), /re-scopes mint_user/);
      assert.deepEqual(writes(seen), []);
    });
  });
});

/**
 * ★ The name is an Output of an upstream role whose `ttl` is changing, so no diff can see it at plan.
 *   Reconcile refuses the `update`; the next deploy, with the value settled, plans `replace`.
 */
describe('an update across a move the diff could not see', () => {
  it('Bao.CloudflareRole: refused before any write, then replaced', async () => {
    const store = cloudflareRoles();
    const body = (ttl: string): StackBody =>
      Effect.gen(function* () {
        const up = yield* BaoCloudflareRole('Upstream', { ...CF, name: 'upstream', ttl });
        const name = Output.interpolate`role-${up.ttl}`;
        yield* BaoCloudflareRole('Role', { ...CF, name }).pipe(RemovalPolicy.destroy());
      });
    await withStack(store, async (deploy) => {
      await deploy(body('5m'));
      await assert.rejects(deploy(body('10m')), /identity moved from .*role-300 to .*role-600/);
      assert.ok(!store.live.has('cloudflare-acme-dns/roles/role-600'));
      assert.deepEqual(await deploy(body('10m')), { Role: 'replace', Upstream: 'noop' });
      assert.ok(!store.live.has('cloudflare-acme-dns/roles/role-300'));
    });
  });

  it('Bao.ProxmoxRole: refused before any write, then replaced', async () => {
    const store = proxmoxRoles();
    const body = (ttl: string): StackBody =>
      Effect.gen(function* () {
        const up = yield* BaoProxmoxRole('Upstream', { ...PVE, name: 'upstream', ttl });
        const name = Output.interpolate`r-${up.ttl}`;
        yield* BaoProxmoxRole('Role', { ...PVE, name }).pipe(RemovalPolicy.destroy());
      });
    await withStack(store, async (deploy) => {
      await deploy(body('1h'));
      await assert.rejects(deploy(body('2h')), /identity moved from .*r-1h to .*r-2h/);
      assert.ok(!store.live.has('proxmox-lab/roles/r-2h'));
      assert.deepEqual(await deploy(body('2h')), { Role: 'replace', Upstream: 'noop' });
      assert.deepEqual(livePaths(store), ['proxmox-lab/roles/r-2h', 'proxmox-lab/roles/upstream']);
    });
  });
});

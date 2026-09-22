/**
 * The five families fake-families.ts does not cover — Bao.Policy, Bao.CloudflareRole,
 * Bao.ProxmoxRole, Bao.Mount and Bao.AuthMethod — as rows of one table over one routed fake, so the
 * ownership tests (adopt-core.test.ts) drive each through Alchemy's own plan and apply. Each row
 * declares one object whose identity is fixed; `knob` is a duration-like prop that is NOT its
 * identity, so an Output can stand in for it and a second owner can change it.
 *
 * ⛔ TEST-ONLY. Every value is a placeholder, not the estate's.
 */
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import type * as Output from 'alchemy/Output';
import { BaoAuthMethod, BaoAuthMethodProvider } from './auth-method.ts';
import { BaoAuthRoleProvider } from './auth-role.ts';
import { groupKey } from './cloudflare-group-scope.ts';
import { CloudflarePermissionGroups } from './cloudflare-permission-groups.ts';
import { BaoCloudflareRole, BaoCloudflareRoleProvider } from './cloudflare-role.ts';
import type { Reply, Seen } from './fake-bao.ts';
import { aclPolicies, cloudflareRoles, fakePolicyProviders, proxmoxRoles } from './fake-engines.ts';
import { wireRoles } from './fake-engines-roles.ts';
import { liveTable } from './fake-mounts.ts';
import { type FakeStack, type StackBody, fakeStack, withFakeStack } from './fake-stack.ts';
import { BaoMount, BaoMountProvider } from './mount.ts';
import { BaoPolicy } from './policy.ts';
import { BaoProxmoxRole, BaoProxmoxRoleProvider } from './proxmox-role.ts';

/** Every group resolves, to an id named after it — these tests are about ownership, not groups. */
const groups = Layer.succeed(CloudflarePermissionGroups, {
  resolve: (_mount, refs) =>
    Effect.succeed(new Map(refs.map((ref) => [groupKey(ref.name, ref.scope), `id-${ref.name}`]))),
});

export const coreProviders = Layer.mergeAll(
  fakePolicyProviders,
  BaoCloudflareRoleProvider().pipe(Layer.provide(groups)),
  BaoProxmoxRoleProvider(),
  BaoMountProvider(),
  BaoAuthMethodProvider(),
  // ★ For `upstream`: an AppRole whose `tokenTtl` is the Output a knob is fed.
  BaoAuthRoleProvider(),
  FetchHttpClient.layer,
);

/** Every store behind one answer, routed by path. */
export const coreEstate = () => {
  const stores = {
    auth: liveTable('sys/auth', {}),
    cloudflare: cloudflareRoles(),
    mounts: liveTable('sys/mounts', {}),
    policies: aclPolicies(),
    proxmox: proxmoxRoles(),
    roles: wireRoles(),
  };
  const answer = (seen: Seen): Reply => {
    const path = seen.path.replace(/^\/v1\//, '');
    if (path.startsWith('sys/policies/acl/')) return stores.policies(seen);
    if (path.startsWith('sys/auth')) return stores.auth.answer(seen);
    if (path.startsWith('sys/mounts') || path.startsWith('sys/remount')) {
      return stores.mounts.answer(seen);
    }
    if (path.startsWith('cloudflare-acme-dns/')) return stores.cloudflare(seen);
    if (path.startsWith('proxmox-lab/')) return stores.proxmox(seen);
    return stores.roles(seen);
  };
  return Object.assign(answer, stores);
};

export type CoreEstate = ReturnType<typeof coreEstate>;

type Text = string | Output.Output<string>;

export interface CoreRow {
  readonly family: string;
  /** One resource, logical id `id`, at the row's fixed identity. */
  readonly declare: (id: string, knob: Text) => StackBody;
  /** Whether the fake holds the object. */
  readonly has: (estate: CoreEstate) => boolean;
}

export const CORE: readonly CoreRow[] = [
  {
    // ★ The fragments directory IS the content (fake-engines.ts), so a knob changes the policy.
    declare: (id, knob) => BaoPolicy(id, { fragments: knob, name: 'app' }),
    family: 'Bao.Policy',
    has: (estate) => estate.policies.live.has('sys/policies/acl/app'),
  },
  {
    declare: (id, knob) =>
      BaoCloudflareRole(id, {
        description: 'Read DNS records on one zone. (zone: example.com)',
        maxTtl: '1h',
        mount: 'cloudflare-acme-dns',
        name: 'dns-read',
        policies: [
          {
            effect: 'allow',
            groupOrder: 'declared',
            groups: ['DNS Read'],
            resource: 'com.cloudflare.api.account.zone.z1',
          },
        ],
        ttl: knob,
      }),
    family: 'Bao.CloudflareRole',
    has: (estate) => estate.cloudflare.live.has('cloudflare-acme-dns/roles/dns-read'),
  },
  {
    declare: (id, knob) =>
      BaoProxmoxRole(id, {
        maxTtl: '6h',
        mintUser: 'reader@pve',
        mount: 'proxmox-lab',
        name: 'read',
        ttl: knob,
      }),
    family: 'Bao.ProxmoxRole',
    has: (estate) => estate.proxmox.live.has('proxmox-lab/roles/read'),
  },
  {
    declare: (id, knob) => BaoMount(id, { defaultLeaseTtl: knob, path: 'kv', type: 'kv' }),
    family: 'Bao.Mount',
    has: (estate) => estate.mounts.table.has('kv/'),
  },
  {
    declare: (id, knob) => BaoAuthMethod(id, { defaultLeaseTtl: knob, path: 'jwt', type: 'jwt' }),
    family: 'Bao.AuthMethod',
    has: (estate) => estate.auth.table.has('jwt/'),
  },
];

/** One stack over a fresh core estate, plus `owner`: a second stack over the same fake. */
export const withCore = (
  body: (stack: FakeStack, estate: CoreEstate, seen: Seen[], owner: FakeStack) => Promise<void>,
  answer: (estate: CoreEstate) => (seen: Seen) => Reply = (estate) => estate,
): Promise<void> => {
  const estate = coreEstate();
  return withFakeStack(coreProviders, answer(estate), (stack, bao) =>
    body(stack, estate, bao.seen, fakeStack(coreProviders, { BAO_ADDR: bao.address }, 'Owner')),
  );
};

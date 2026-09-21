/**
 * The nine batch-2 families as rows of one table, so a rename test can run each of them through
 * Alchemy's own plan and apply (fake-stack.ts) against one fake (fake-engines-roles.ts). Every row
 * declares a resource whose identity is `name` (for Bao.JwtAuthConfig, the mount), with `knob`, a
 * duration, in a prop that is NOT its identity: the pending Output in "a rename lands with another
 * pending prop".
 *
 * ⛔ TEST-ONLY. Every value is a placeholder, not the estate's.
 */
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import type * as Output from 'alchemy/Output';
import * as Effect from 'effect/Effect';
import * as Layer from 'effect/Layer';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';
import { BaoAuthRole, BaoAuthRoleProvider } from './auth-role.ts';
import type { Seen } from './fake-bao.ts';
import { type Estate, fakeEstate } from './fake-engines-roles.ts';
import { type FakeStack, type StackBody, withFakeStack } from './fake-stack.ts';
import { BaoJwtAuthConfig, BaoJwtAuthConfigProvider } from './jwt-config.ts';
import { BaoJwtRole, BaoJwtRoleProvider } from './jwt-role.ts';
import { BaoKubernetesRole, BaoKubernetesRoleProvider } from './kubernetes-role.ts';
import { BaoMfaLoginEnforcement, BaoMfaLoginEnforcementProvider } from './mfa-enforcement.ts';
import { BaoMfaTotpMethod, BaoMfaTotpMethodProvider } from './mfa-totp.ts';
import { BaoPkiRole, BaoPkiRoleProvider } from './pki-role.ts';
import { BaoPlugin, BaoPluginProvider } from './plugin.ts';
import { BaoSshRole, BaoSshRoleProvider } from './ssh-role.ts';

export const familyProviders = Layer.mergeAll(
  BaoAuthRoleProvider(),
  BaoJwtAuthConfigProvider(),
  BaoJwtRoleProvider(),
  BaoKubernetesRoleProvider(),
  BaoMfaLoginEnforcementProvider(),
  BaoMfaTotpMethodProvider(),
  BaoPkiRoleProvider(),
  BaoPluginProvider(),
  BaoSshRoleProvider(),
  FetchHttpClient.layer,
);

/** One stack over a fresh estate: every family's provider, and every call the fake saw. */
export const withEstate = (
  body: (stack: FakeStack, estate: Estate, seen: Seen[]) => Promise<void>,
): Promise<void> => {
  const estate = fakeEstate();
  return withFakeStack(familyProviders, estate, (stack, bao) => body(stack, estate, bao.seen));
};

/** The row for one family, by name. */
export const rowOf = (family: string): Family => {
  const row = FAMILIES.find((each) => each.family === family);
  if (row === undefined) throw new Error(`no fake-families row for ${family}`);
  return row;
};

type Text = string | Output.Output<string>;
type Removal = typeof RemovalPolicy.destroy;

export interface Family {
  readonly family: string;
  /** One resource, logical id `id`, whose identity is `name`. */
  readonly declare: (id: string, name: Text, knob: Text, removal?: Removal) => StackBody;
  /** Whether the fake holds the object `name` names. */
  readonly has: (estate: Estate, name: string) => boolean;
}

const role = (path: (name: string) => string) => (estate: Estate, name: string) =>
  estate.roles.live.has(path(name));

const APPROLE = { secretIdTtl: '24h', tokenMaxTtl: '1h', tokenPolicies: ['default'] } as const;
const SHA = 'a'.repeat(64);

export const FAMILIES: readonly Family[] = [
  {
    declare: (id, name, knob, removal = RemovalPolicy.retain) =>
      BaoAuthRole(id, { ...APPROLE, name, tokenTtl: knob }).pipe(removal()),
    family: 'Bao.AuthRole',
    has: role((name) => `auth/approle/role/${name}`),
  },
  {
    declare: (id, name, knob, removal = RemovalPolicy.retain) =>
      BaoPkiRole(id, { allowedDomains: ['example.com'], maxTtl: '8760h', name, ttl: knob }).pipe(
        removal(),
      ),
    family: 'Bao.PkiRole',
    has: role((name) => `pki/roles/${name}`),
  },
  {
    declare: (id, name, knob, removal = RemovalPolicy.retain) =>
      BaoJwtRole(id, {
        boundAudiences: ['https://example.com'],
        name,
        roleType: 'jwt',
        tokenPolicies: ['ci'],
        tokenTtl: knob,
        userClaim: 'sub',
      }).pipe(removal()),
    family: 'Bao.JwtRole',
    has: role((name) => `auth/jwt/role/${name}`),
  },
  {
    declare: (id, name, knob, removal = RemovalPolicy.retain) =>
      BaoKubernetesRole(id, {
        aliasNameSource: 'serviceaccount_uid',
        boundServiceAccountNames: ['app'],
        boundServiceAccountNamespaces: ['apps'],
        name,
        tokenPolicies: ['app'],
        tokenTtl: knob,
      }).pipe(removal()),
    family: 'Bao.KubernetesRole',
    has: role((name) => `auth/kubernetes/role/${name}`),
  },
  {
    declare: (id, mount, knob, removal = RemovalPolicy.retain) =>
      BaoJwtAuthConfig(id, {
        boundIssuer: knob,
        jwksUrl: 'https://issuer.example.com/keys',
        mount,
      }).pipe(removal()),
    family: 'Bao.JwtAuthConfig',
    has: role((mount) => `auth/${mount}/config`),
  },
  {
    declare: (id, name, knob, removal = RemovalPolicy.retain) =>
      BaoMfaTotpMethod(id, { issuer: knob, name }).pipe(removal()),
    family: 'Bao.MfaTotpMethod',
    has: (estate, name) => [...estate.totp.live.values()].some((each) => each['name'] === name),
  },
  {
    declare: (id, name, knob, removal = RemovalPolicy.retain) =>
      BaoMfaLoginEnforcement(id, {
        authMethodTypes: ['jwt'],
        mfaMethodIds: [knob],
        name,
      }).pipe(removal()),
    family: 'Bao.MfaLoginEnforcement',
    has: role((name) => `identity/mfa/login-enforcement/${name}`),
  },
  {
    declare: (id, name, knob, removal = RemovalPolicy.retain) =>
      BaoSshRole(id, {
        allowUserCertificates: true,
        allowedUsers: ['ops'],
        maxTtl: '8h',
        name,
        ttl: knob,
      }).pipe(removal()),
    family: 'Bao.SshRole',
    has: role((name) => `ssh/roles/${name}`),
  },
  {
    declare: (id, name, knob, removal = RemovalPolicy.retain) =>
      BaoPlugin(id, {
        args: [knob],
        command: 'plugin-example',
        name,
        sha256: SHA,
        type: 'secret',
        version: 'v1.0.0',
      }).pipe(removal()),
    family: 'Bao.Plugin',
    has: (estate, name) =>
      estate.plugins.live.has(`sys/plugins/catalog/secret/${name}?version=v1.0.0`),
  },
];

/**
 * Two of one family, `X` and `Y`, under destroy: the shape a swap or a shift needs. Their knobs
 * differ, so a generation that lands on the other's name has to write over it.
 */
export const pairOf =
  (row: Family) =>
  (x: string, y: string): StackBody =>
    Effect.gen(function* () {
      yield* row.declare('X', x, '15m', RemovalPolicy.destroy);
      yield* row.declare('Y', y, '30m', RemovalPolicy.destroy);
    });

/** An AppRole whose `tokenTtl` attribute is the Output the other rows are fed. */
export const upstream = (ttl: string) =>
  BaoAuthRole('Upstream', { ...APPROLE, name: 'upstream', tokenTtl: ttl });

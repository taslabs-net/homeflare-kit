# `@homeflare/alchemy/openbao`

Vault objects as Alchemy resources: `BaoMount`, `BaoAuthMethod`, `BaoPolicy`, `BaoAuthRole`,
`BaoJwtRole`, `BaoKubernetesRole`, `BaoJwtAuthConfig`, `BaoMfaTotpMethod`,
`BaoMfaLoginEnforcement`, `BaoPkiRole`, `BaoSshRole`, `BaoCloudflareRole`, `BaoProxmoxRole` and
`BaoPlugin`. It also has three plain helpers: `assertBaoIdentity`, `hostAppRoles` and
`appRoleLogin`.

Every call resolves `BAO_ADDR`, `BAO_AGENT_ADDR`, `BAO_NAMESPACE` and `BAO_TOKEN` (or their
`VAULT_*` twins) the same way the `bao` CLI does. A stack provides each `Bao*Provider()` it uses,
plus `FetchHttpClient.layer`.

- ⛔ **Metadata only.** Alchemy stores props and attributes unencrypted, so you cannot declare a
  secret, a CA key, a plugin `env` or an OIDC client secret.
- Every family defaults to `retain` on destroy. For what a rename does, read
  [REPLACE.md](./REPLACE.md) before you change any resource's path or name.
- ⛔ A rename or move onto a name or path that already exists fails the plan, before anything is
  written (every family but the mounts, whose moves are below). Move through a free name, in two
  deploys, or remove the target first.
- ⚠️ A NEW logical id for a live name adopts it, and under `destroy` the old id's delete then
  removes it. Change a logical id with Alchemy's `renamedFrom` (REPLACE.md).

## assertBaoIdentity: call it first

```ts
import { assertBaoIdentityEffect } from '@homeflare/alchemy/openbao';

export const guarded = Effect.gen(function* () {
  yield* assertBaoIdentityEffect({ clusterName: 'vault-example', namespace: 'team-a' });
  // …every Bao.* resource after this
});
```

- It reads the unauthenticated `sys/health` with no token and no namespace header, because
  health is root-only. It refuses a sealed vault, the wrong `cluster_name`, a `BAO_NAMESPACE`
  that is not the expected one, and a namespace the cluster does not have.
- ⚠️ It fails with a `BaoIdentityError` whose message starts with `REFUSING:`. The `reason` is
  `input`, `mismatch`, `unconfirmed` or `unreachable`. `assertBaoIdentity` is the Promise form.
- ⚠️ It catches a mis-set address, not an impostor. Any server can repeat a `cluster_name`;
  TLS is what proves which server answered.

## BaoMount / BaoAuthMethod: moving a path

```ts
export const kv = Effect.gen(function* () {
  yield* BaoMount('kv', { path: 'secrets', remountFrom: 'kv', type: 'kv', version: 2 });
});
```

- ⛔ If `path` changes, the plan now fails unless `remountFrom` names the old path. Before this, a
  path change enabled an empty mount at the new path.
- With `remountFrom`, the provider moves the mount with `sys/remount` and polls until the move is
  done, so the data stays. ⛔ The move revokes every lease under the old path, and it does not
  rewrite policies that name that path. The deploying token needs `sudo` on `sys/remount`.

## hostAppRoles: one AppRole per host

```ts
export const hostRoles = Effect.gen(function* () {
  const roles = hostAppRoles({
    classes: {
      'pve-node': {
        policies: ['pve-node'],
        secretIdTtl: '2160h',
        tokenMaxTtl: '1h',
        tokenTtl: '15m',
      },
    },
    hosts: [{ class: 'pve-node', name: 'node-a' }],
  });
  for (const props of roles) yield* BaoAuthRole(props.name, props); // `pve-node--node-a`
});
```

- A role is named `<class>--<host>`. Class and host names may contain only lowercase letters,
  digits and single hyphens.
- It refuses `secretIdTtl` 0 (a secret_id that never expires), empty policies, `root`, unknown
  classes and a host listed twice in one class. A host in several classes gets one role per class.
- ⚠️ Renaming a host or class makes a new role. Under `retain` the old one stays live and keeps
  admitting its secret_ids (REPLACE.md). Under `destroy` its secret_ids go, but tokens it already
  issued run to their TTL: deleting a role revokes no token.

## BaoJwtRole / BaoKubernetesRole / BaoJwtAuthConfig

```ts
export const machines = Effect.gen(function* () {
  const issuer = 'https://issuer.example.com';
  yield* BaoJwtAuthConfig('gh', {
    boundIssuer: issuer,
    mount: 'jwt-github',
    oidcDiscoveryUrl: issuer,
  });
  yield* BaoJwtRole('ci', {
    boundAudiences: ['https://example.com/org'],
    boundClaims: { ref: 'refs/heads/main' },
    mount: 'jwt-github',
    name: 'ci-app',
    roleType: 'jwt',
    tokenPolicies: ['ci-app'],
    tokenTtl: '10m',
    userClaim: 'repository',
  });
  yield* BaoKubernetesRole('pod', {
    aliasNameSource: 'serviceaccount_name',
    boundServiceAccountNames: ['litellm'],
    boundServiceAccountNamespaces: ['ai'],
    name: 'ai-litellm',
    tokenPolicies: ['ai-litellm'],
  });
});
```

- ⛔ `roleType` is required. OpenBao's default is `oidc`, even when it rewrites a `jwt` role.
- ⛔ `aliasNameSource` is required too. Changing it on a live role moves every pod to a new entity.
- Every managed field is sent on every write, so a value someone set by hand cannot sit
  unnoticed behind a green plan. `verbose_oidc_logging` and `oidc_disable_confirmation` are
  always sent as `false`.
- ⛔ `BaoJwtAuthConfig` has no OIDC client secret, and it refuses a mount whose live config has
  an `oidc_client_id`: its full-replace write would erase that secret, which the read never
  returns. It has no delete endpoint, so its delete writes nothing.

## Login MFA: BaoMfaTotpMethod + BaoMfaLoginEnforcement

```ts
export const adminMfa = Effect.gen(function* () {
  const totp = yield* BaoMfaTotpMethod('admin-totp', {
    issuer: 'vault-example',
    name: 'admin-totp',
  });
  yield* BaoMfaLoginEnforcement('admin-mfa', {
    authMethodPaths: ['oidc-admin'],
    mfaMethodIds: [totp.methodId],
    name: 'admin-mfa',
  });
});
```

- ⛔ **Enrol before you enforce.** An entity with no TOTP secret fails every login the
  enforcement matches. Enrol admins with `admin-generate`, never through Alchemy.
- ⚠️ An enforcement matches mounts, identity groups or entities. It never matches a role. Target
  mounts by path; `authMethodTypes: ['jwt']` also catches machine JWT mounts.
- ⛔ Renaming a TOTP method fails the plan, because it would strand every enrolled secret.
  Deleting an enforcement is refused: in OpenBao 2.6.2 a delete comes back after a restart
  (openbao/openbao#4030).

## appRoleLogin / revokeSelf (for scripts)

```ts
const login = await appRoleLogin({ roleId, secretId }); // mount defaults to `approle`
try {
  use(login.clientToken, login.accessor, login.policies, login.leaseDurationSeconds);
} finally {
  await revokeSelf(login.clientToken);
}
```

- ⛔ The login never sends `BAO_TOKEN`, and a `BaoLoginError` never contains the credential.
  OpenBao can echo a secret_id back in an error, so every error string is redacted.
- ⚠️ `clientToken` is a getter over a private field. `console.log(login)` prints `[Getter]` at
  most under Bun and nothing under Node. JSON, a spread and `structuredClone` carry no token.
- ⚠️ A value with leading or trailing whitespace is refused, not trimmed. Note that
  `Bun.file().text()` keeps a file's trailing newline.
- The error's `reason` is `input`, `refused`, `unreachable` or `response`. Pass `env` to use
  something other than `process.env`. `appRoleLoginEffect` and `revokeSelfEffect` are the same
  calls as Effects.

## BaoPlugin

```ts
export const plugins = Effect.gen(function* () {
  yield* BaoPlugin('plugin-example', {
    name: 'openbao-plugin-secrets-example',
    type: 'secret', // 'secret' | 'auth' | 'database'
    command: 'openbao-plugin-secrets-example', // a bare file name in plugin_directory
    sha256: '<hex sha256 of that file>',
    version: 'v0.1.2', // canonical semver
  });
});
```

- ⛔ It registers a binary that is already in `plugin_directory`. It does not copy the binary.
- ⚠️ **If the binary reports its own version, declare exactly that version.** OpenBao refuses any
  other version ("plugin version mismatch"). It files an unversioned registration under the
  reported version, and reconcile then refuses because the read-back finds nothing.
- ⚠️ A new `sha256` does not restart running mounts. Reload them with
  `sys/plugins/reload/backend`.
- The deploying token needs `sudo` on `sys/plugins/catalog/*`.

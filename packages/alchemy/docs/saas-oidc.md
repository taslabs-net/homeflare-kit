# SaasOidcApplication — Access as an OIDC provider, with no client secret in state

`SaasOidcApplication` (`HomeFlare.Access.SaasOidcApplication`) declares a Cloudflare Access **SaaS
application** of auth type `oidc`: Access acts as the OpenID Connect provider for one relying
party (OpenBao's OIDC auth, Headlamp, a Kubernetes API server). It exposes the issuer, the client
id and the JWKS endpoint as attributes, so the relying party's configuration can be declared from
them. Read 2026-10-09 against `alchemy@2.0.0-beta.81` and
`@distilled.cloud/cloudflare@1.0.0-rc.13`.

## Why not `Cloudflare.Access.Application`

- **It cannot send or read `saas_app`.** Its source mentions `saas` only as an app type and in two
  comments (`Cloudflare/Access/Application.ts`, beta.81). An OIDC app is the `saas_app` object.
- **The SDK drops it on the way back.** The request type carries `saasApp`
  (`AccessApplicationsCreateRequestSaasAppOIDCSaaSApp`), so create and update use it. But a fake
  API that answered a full `saas_app` decoded, for both `getAccessApplicationForAccount` and
  `createAccessApplicationForAccount`, to `{ domain, type, id, aud, name, policies }` (measured
  2026-10-09). So the client id, redirect URIs, scopes and grants are read from the wire JSON by
  one raw `GET /accounts/{account_id}/access/apps/{app_id}`, over the same `HttpClient` and
  credentials the SDK uses. That one read is the only hand-written call; it adds no path.
- Track upstream: when Alchemy's `Access.Application` gains `saas_app` (and distilled decodes it),
  this resource should be retired in its favour. Nothing is filed upstream from here.

## Declaring an app

```ts
import { SaasOidcApplication, providers } from '@homeflare/alchemy/cloudflare';

// providers: Layer.mergeAll(Cloudflare.providers(), providers()),
const headlamp =
  yield *
  SaasOidcApplication('Headlamp', {
    name: 'Headlamp',
    teamDomain: 'example.cloudflareaccess.com',
    policies: [adminPolicyId],
    saasApp: {
      authType: 'oidc',
      redirectUris: ['https://headlamp.example.com/oidc-callback'],
      scopes: ['openid', 'email', 'groups'],
      grantTypes: ['authorization_code_with_pkce'],
      accessTokenLifetime: '15m',
      allowPkceWithoutClientSecret: true, // a public client: no secret exists
    },
  });
// headlamp.issuer, headlamp.clientId, headlamp.jwksEndpoint
```

| prop                                           | notes                                                                                       |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `teamDomain`                                   | **Required.** Bare hostname of the Zero Trust team, no scheme or path.                      |
| `applicationId`                                | Optional. Set it to adopt a known live app; otherwise the app is found by exact `name`.     |
| `name`                                         | Optional. Defaults to a physical name from the logical id.                                  |
| `policies`                                     | Reusable Access policy ids, in precedence order.                                            |
| `sessionDuration`, `allowedIdps`               | Optional. Written on create and on any sync. `sessionDuration` defaults to `24h`.           |
| `autoRedirectToIdentity`, `appLauncherVisible` | Optional. `appLauncherVisible` defaults to `false`.                                         |
| `saasApp.redirectUris`, `scopes`, `grantTypes` | The OIDC client's settings.                                                                 |
| `saasApp.accessTokenLifetime`                  | `m` or `h` units, `1m` to `24h` (the SDK field doc).                                        |
| `saasApp.refreshTokenLifetime`                 | Optional. Needed for the `refresh_tokens` grant.                                            |
| `saasApp.allowPkceWithoutClientSecret`         | `true` = public client. Needs the `authorization_code_with_pkce` grant (refused otherwise). |

Attributes: everything above that Cloudflare reports, plus `applicationId`, `aud`, `clientId`,
`accountId`, `teamDomain`, `domain`, and the OIDC URLs `issuer`
(`https://<teamDomain>/cdn-cgi/access/sso/oidc/<clientId>`), `authorizationEndpoint`,
`tokenEndpoint`, `jwksEndpoint`, `userinfoEndpoint` and `configurationEndpoint`.

★ **The team domain is a prop, not a constant.** The openbao copy this came from hardcoded one
account's. A declared `teamDomain` that disagrees with the host Cloudflare reports in the app's own
`domain` is refused before any write, so the issuer cannot point at a different team.

## The client secret

⛔ **It is never read, stored or logged by this package.** The SDK schema's own doc says the secret
is "only returned on POST request". The create response is decoded by the SDK (which drops it, see
above); the raw read copies named fields and has no field for it; the attributes have none; and a
create refuses to run while `DISTILLED_DEBUG_HTTP` is set, because distilled would then print the
first 400 characters of the response to stderr (`protocol.ts`). `saas-oidc-state.test.ts` serialises
the whole in-memory state after a create whose fake response hands a secret out, and asserts it is
absent.

- **A public client has no secret to keep** (`allowPkceWithoutClientSecret: true` with the PKCE
  grant). That is the design for Headlamp (Q6 of the Kubernetes platform decisions).
- **A confidential client's secret is out of band.** This resource does not capture it. How to
  obtain or rotate it for an existing app is UNVERIFIED here (no documented rotate verb was read);
  homeflare-openbao keeps its live one in the macOS Keychain.
- UNVERIFIED: whether Cloudflare still returns a `client_secret` on POST for a PKCE-without-secret
  app. It does not matter here, since it is dropped either way.

## Adopting the openbao app, and the state key

⛔ **The type id `HomeFlare.Access.SaasOidcApplication` is kept verbatim.** Alchemy state rows are
keyed by it, and homeflare-openbao's live `OpenBaoOidcSaas` row was written under it. A different
id plans a second app (new client id, new `aud`) beside the orphaned live one. The state test
seeds a row in the old shape (no `teamDomain`) and proves the next deploy updates it in place:
no create, no delete, the same application and client ids.

- State written before `teamDomain` existed still reads: the host from the app's own `domain`
  stands in until the next reconcile stores the declared one.
- homeflare-openbao's stack must merge this package's `providers()` (the kit's collection) where it
  merged `Cloudflare.providers()` for this type, and add `teamDomain` to its declaration.
- A live app is `Unowned` until the declaration says `adopt(true)`, like every kit resource.

## What a change does

- **Created** when no app has the id or the exact name. Names are not unique in Access, so two
  saas apps with the declared name are refused: set `applicationId`.
- **Synced** (one PUT of the whole declaration) when the name, auth type, redirect URIs, scopes,
  grant types, either token lifetime, the PKCE flag or the policy set differ. Set order is ignored.
- ⚠️ **Not drift-checked:** `sessionDuration`, `allowedIdps`, `autoRedirectToIdentity`,
  `appLauncherVisible`, `appLauncherUrl`. They are written on create and on any sync, but a change
  to only those does not trigger one. This is carried over from the openbao copy unchanged.
- A matching live app is **zero writes**.
- An `applicationId` that is not a `saas` app is refused, never rewritten.
- Retries follow Alchemy's own `retryTransientAccessError` (same file as above): a freshly created
  policy still propagating, and 403 as Cloudflare's throttle. About 45 seconds, then it fails.

⛔ **Removal policy: `retain` by default**, because deleting the app deletes the client id every
relying party is configured with. `delete` stays fully implemented (an app already gone is a
success): opt in with `.pipe(RemovalPolicy.destroy())`. `list` is empty and `nuke` is skipped:
Alchemy's own `Access.Application` already lists every Access app, saas ones included.

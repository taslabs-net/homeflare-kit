---
'@homeflare/alchemy': minor
---

Add `SaasOidcApplication` (`HomeFlare.Access.SaasOidcApplication`) to `@homeflare/alchemy/cloudflare`,
moved from homeflare-openbao's `src/cloudflare/saas-oidc.ts` for the Kubernetes platform's Headlamp
login (ledger row `k8s-kit-saas-oidc`). A Cloudflare Access SaaS application of auth type `oidc`:
Alchemy `Access.Application` has no `saas_app` (checked in beta.81), and distilled rc.13 decodes a
saas app's GET and create response without it, so the client id is read from the wire JSON.

- The type id is kept verbatim, because Alchemy state is keyed by it and openbao's live
  `OpenBaoOidcSaas` row was written under it. A test seeds a row in the old shape and proves the
  next deploy updates it in place.
- New required prop `teamDomain` replaces the hardcoded team domain in the issuer. A declaration
  that disagrees with the host Cloudflare reports for the app is refused before any write.
- The attributes expose `issuer`, `clientId` and `jwksEndpoint`, plus the other OIDC endpoints and
  `teamDomain`.
- The client secret is never read, stored or logged (tests cover `allowPkceWithoutClientSecret`
  with the `authorization_code_with_pkce` grant, and serialise the engine's state after a create
  whose response carries a secret). A write refuses to run while `DISTILLED_DEBUG_HTTP` is set.
- Behaviour differences from the openbao copy: `retain` is now the default removal policy;
  `allowPkceWithoutClientSecret: true` without the PKCE grant is refused; an `applicationId` that is
  not a saas app is refused instead of rewritten; two same-named saas apps are refused instead of
  picking the first; delete folds only `AccessApplicationNotFound` instead of every error.

- Open question for Tim: the one raw `GET` of the app is hand-written (lane contract 1) because the
  SDK drops `saas_app`; see `docs/saas-oidc.md`.

Walked against `alchemy@2.0.0-beta.81` and `@distilled.cloud/cloudflare@1.0.0-rc.13`. Guide:
`packages/alchemy/docs/saas-oidc.md`.

---
'@homeflare/site': minor
---

Add `@homeflare/site`: one typed site config (Effect Schema) and every name derived from it. The site file holds base values (apex, labels, zones, networks, hosts) and pinned values. `derive()` builds hostnames, leg addresses, zone suffixes, the Access team URLs, the vault's public / Mesh / LAN addresses, its OIDC redirects and the `cloudflare-<alias>-<surface>` mount names. An unknown product, service, zone, host, cluster, account or pin throws; there is no fallback host.

Physical names, certificate hostnames, adopted ids, policy lists and SSH principal lists are pinned (`pins()`), never derived. `inventory()`, `unknownPrincipals()` and `pinnedPrincipalIssues()` let a consumer assert a pinned list is a subset of what the site declares.

`@homeflare/site/load` reads `HF_SITE_FILE` (plain JSON, no default path; the refusal names `site.example.json`), refuses a file that is not committed and unmodified on `main` unless `siteDev` is set, and accepts only the scalar `HF_SITE_*` overrides in `ENV_OVERRIDES`. Every site carries `version` and `deriveVersion`, and a site reviewed against another package version is refused. `assertStage` refuses stage `live` for a non-live site, and `compareIdentity` / `assertIdentity` compare the expected vault cluster name, namespace and Cloudflare account id with what a caller observed. `SITE_TOKENS`, `tokenValues()` and `renderTokens()` cover the placeholders public docs use.

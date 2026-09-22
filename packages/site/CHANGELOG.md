# @homeflare/site

## 0.1.1

### Patch Changes

- [#93](https://github.com/taslabs-net/homeflare-kit/pull/93) [`d3c332b`](https://github.com/taslabs-net/homeflare-kit/commit/d3c332bd4f175cc3510b7ae06ff98f4b426f0c52) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The published sources, docs and examples no longer name the maintainer's own infrastructure.
  Node names, cluster and pool names, NICs, VLANs, addresses, hostnames, guest ids, principals and
  policy names in comments, fixtures and examples are now neutral placeholders: nodes `node-a`…
  `node-d`, a reference cluster `C1`, documentation addresses (RFC 5737), `bao.example.internal`.
  Measured facts are unchanged; only the names are. `site.example.json` names its hosts `node-a`…
  `node-c`. One runtime message changed: `forgejo-bootstrap` now says to run on "the host where
  Forgejo runs". The historical CHANGELOG entries are unchanged.

## 0.1.0

### Minor Changes

- [#66](https://github.com/taslabs-net/homeflare-kit/pull/66) [`1fbc9f2`](https://github.com/taslabs-net/homeflare-kit/commit/1fbc9f2192a32a0c8f17341cb8742c6ae4798161) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Add `@homeflare/site`: one typed site config (Effect Schema) and every name derived from it. The site file holds base values (apex, labels, zones, networks, hosts) and pinned values. `derive()` builds hostnames, leg addresses, zone suffixes, the Access team URLs, the vault's public / Mesh / LAN addresses, its OIDC redirects and the `cloudflare-<alias>-<surface>` mount names. An unknown product, service, zone, host, cluster, account or pin throws; there is no fallback host.

  Physical names, certificate hostnames, adopted ids, policy lists and SSH principal lists are pinned (`pins()`), never derived. `inventory()`, `unknownPrincipals()` and `pinnedPrincipalIssues()` let a consumer assert a pinned list is a subset of what the site declares.

  `@homeflare/site/load` reads `HF_SITE_FILE` (plain JSON, no default path; the refusal names `site.example.json`), refuses a file that is not committed and unmodified on `main` unless `siteDev` is set (by blob hash, with symlinks resolved), and accepts only the scalar `HF_SITE_*` overrides in `ENV_OVERRIDES`, and only with `siteDev`. Guard fields (`version`, `deriveVersion`, `kind`, `vault.clusterName`, `vault.namespace`) are never overridable. Every site carries `version` and `deriveVersion`, and a site reviewed against another package version is refused. `assertStage` refuses stage `live` for a non-live site, and `compareIdentity` / `assertIdentity` compare the expected vault cluster name, namespace and Cloudflare account id with what a caller observed; an unobserved field, or an expectation naming no field, refuses. `SITE_TOKENS`, `tokenValues()` and `renderTokens()` cover the placeholders public docs use.

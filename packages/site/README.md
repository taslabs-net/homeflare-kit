# @homeflare/site

One typed site config. The file holds **base values** (an apex, a few labels, networks,
hosts) and **pinned values**; `derive()` builds every hostname, address, zone suffix,
Access URL, OIDC redirect and vault mount name from it, the same way in every repo.

```sh
bun add @homeflare/site effect@4.0.0-rc.115
```

⛔ **`effect` is a pinned peer.** Effect release candidates are not compatible with each
other, and the override behaviour this package relies on is measured per version.

★ **Why.** A public stack that types a hostname cannot be run by anyone else, and a stack
that re-derives a name its own way drifts from its siblings. Swapping the apex here
changes every derived name by substitution and nothing else — a test proves it.

## Load it

```ts
import { derive, assertStage } from '@homeflare/site';
import { loadSite } from '@homeflare/site/load'; // Node / Bun: reads a file, spawns git

const { site, overrides } = await loadSite({ siteDev: flags.siteDev });
if (overrides.length > 0) console.warn('site overrides:', overrides.join(', '));
assertStage(site, stage);
const d = derive(site);
d.vault.publicAddr; // https://api.v.example.com
```

- `HF_SITE_FILE` names the file. ⛔ **There is no default path**: without it `loadSite`
  refuses and points at `node_modules/@homeflare/site/site.example.json`. Copy that, set
  `kind`, replace every value.
- **Plain JSON**, not JSONC — Nix, jq and Python read the same file.
- ⛔ **Reviewed values only.** Unless `siteDev` is set (your `--site-dev` flag), the file
  must be committed, unmodified, on `main` (`branch` to change it). "Unmodified" is by
  blob hash, so `--skip-worktree` cannot hide an edit, and a symlink is judged by the
  file it points at. `readCheckout` and `checkoutProblem` expose the same check.
- `SITE_FILE_VAR` is `HF_SITE_FILE`; `SITE_EXAMPLE` is the example's path.
- Workers (no filesystem, no env): `decodeSite(json)` from the main entry. It runs
  `validateSite` (references, then the derive-version guard) itself.

### Environment overrides

`ENV_OVERRIDES` lists the only `HF_SITE_*` variables accepted — scalars such as
`HF_SITE_APEX` or `HF_SITE_VAULT_PORT`. Anything else under `HF_SITE_` is refused.
⛔ **Overrides need `siteDev`**: an override is an unreviewed value, like an uncommitted
edit, so a stray `HF_SITE_APEX` in a shell refuses a reviewed load instead of renaming
every derived hostname.

⚠️ **Measured on effect 4.0.0-rc.115**, and each is a test:

- `nested('hf')` must come **before** `constantCase`. The other order looks up
  `hf_SITE_APEX`, so `HF_SITE_APEX` is ignored silently.
- An override inside a record or list **replaces** the whole collection (and upper-cases
  its key), so collections are never overridable.
- `HF_SITE_X_API` shadows `x`: a field named like another plus `_…` breaks the decode.
- ⛔ Guard fields — `version`, `deriveVersion`, `kind`, `vault.clusterName`,
  `vault.namespace` — never: an overridden identity field moves the identity check's
  expectation along with the client.

## Derived names

| call                                    | example value                                   |
| --------------------------------------- | ----------------------------------------------- |
| `d.vault.host` / `d.vault.apiHost`      | `v.example.com` / `api.v.example.com`           |
| `d.vault.meshAddr` / `d.vault.lanAddr`  | `https://198.18.0.2:8200` / `http://hub.mgmt…`  |
| `d.vault.oidcRedirects`                 | UI callback on the vault host, then `localhost` |
| `d.mgmtZone`, `d.zone('lab')`           | `mgmt.example.com`, `lab.example.com`           |
| `d.host('n2')`, `d.address('n2','lab')` | `n2.mgmt.example.com`, `198.51.100.12`          |
| `d.access.teamDomain`                   | `https://example-team.cloudflareaccess.com`     |
| `d.productHost('wiki')`, `d.productUrl` | `kb.example.com` (label), own `domain` if set   |
| `d.serviceUrl('grafana')`               | `http://hub.mgmt.example.com:3000`              |
| `d.clusterMembers('c1')`                | member FQDNs                                    |
| `d.cloudflareMount('main','dns')`       | `cloudflare-main-dns` (all: `cloudflareMounts`) |

⛔ **Unknown keys throw** (`SiteError` code `unknown-key`, listing what is declared). There
is no fallback host: a plausible default is how a typo becomes a DNS record.

`d.access.teamDomain` is exactly what `verifyAccessJwt` in `@homeflare/cloudflare` calls
`teamDomain`.

## Pinned, never derived

`pins(site)` reads `pinned.*` by key: `name`, `certificate`, `adopted`, `policy`,
`principals`.

- ⛔ **Physical names** (Workers, D1, KV, R2, Durable Objects): deriving the alerts D1
  name would replace it and delete its data.
- ⛔ **Certificate hostnames** on adopted certificates: a change reissues and revokes the
  certificate a host is still serving.
- **Adopted ids** (LB pool, WAF ruleset, Ceph / PBS names, PKI CNs), and the vault's
  `clusterName`.
- **Policy and SSH principal lists** stay explicit. `unknownPrincipals`,
  `pinnedPrincipalIssues` and `inventory` let a consumer test assert they are subsets of
  the inventory — a break-glass principal must never vanish because a leg was renamed.

## Guards

- `decodeSite` / `loadSite` refuse a file whose `deriveVersion` is not the installed
  version (`checkDeriveVersion`, code `derive-version`). Read the CHANGELOG, then bump it.
- `assertStage(site, 'live')` refuses unless `kind` is `live`.
- `expectedIdentity(site, { account })`, `compareIdentity`, `assertIdentity`: hand in the
  observed `cluster_name` (from `sys/health`), namespace and Cloudflare account id; any
  mismatch — or anything expected but not observed — refuses, and so does an expectation
  naming no field (it would match any system). Pure: fetches nothing.

## Doc placeholders

`SITE_TOKENS` is the fixed set public docs use: `<apex>`, `<vault-host>`,
`<vault-api-host>`, `<mgmt-zone>`, `<access-team>`, `<github-owner>`, `<estate-root>`,
`<cluster>`. `tokenValues(site)` gives each single-valued token's value (a leak gate's
needles); `renderTokens(text, site)` substitutes them. `<cluster>` is a variable.

⛔ Placeholders use only RFC 2606 names and RFC 5737 / 2544 addresses — never `10/8` or
`100.64/10`, which would blind a leak gate to the ranges it must catch.

## Types and errors

`SiteSchema` (Effect Schema), `Site`, `SiteInput`, `SITE_FORMAT`, `Derived`, `SiteError`
with a stable `code` and `issues` naming each path, `VERSION`.

## License

MIT © Timothy Schneider

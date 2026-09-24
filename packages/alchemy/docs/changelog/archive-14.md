# Alchemy changelog archive 14

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

⛔ This is a bug only a consumer could see, and only one that obeys the rules. A stack may use
Resources the package entry exports and must not deep-import, so it could be handed
`BaoProxmoxRole` and still be unable to name its props — leaving it to write the shape out and
hope it stayed in step. MEASURED 2026-09-22 in homeflare-openbao, which did exactly that for
`BaoProxmoxRole` while declaring the VPS proxmox engine. For that family the cost is highest:
`mount` + `name` + `mintUser` + `ttl` + `maxTtl` IS the whole role, so a hand-written copy
duplicates the entire server-side state of a family whose `mintUser` is its security boundary.

Additive and type-only: no value, signature or runtime behaviour changes, and nothing that was
importable stops being importable. `src/openbao/index-types.test.ts` pins the surface with a
type-only test — `tsc --noEmit` is the assertion, so a family whose props stop being reachable
from the package entry fails here instead of in another repo's next consumer.

- [#107](https://github.com/taslabs-net/homeflare-kit/pull/107) [`734ef60`](https://github.com/taslabs-net/homeflare-kit/commit/734ef6067e504be20c65ce7ec9c221c54554d7e7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The provisioning baseline takes a comment per object, so it can describe a cluster that
  already exists.

  `provisionBaseline` and `provisionBootstrap` carried ONE `comment` for the mint group and
  both mint users. That can only describe a cluster this baseline made. The common case is
  the other one: a cluster that already has its mint group and its read user, each with its
  own live comment, both of them already declared at those values by the stack that adopted
  them. A single comment made the generated script modify all three, and the next deploy of
  that stack wrote them back — a loop that reads like drift and is not. Measured on an
  estate cluster on 2026-09-22, where the mint group had no comment at all and the read user
  named its own mount.

  `ProvisionNames` now adds `groupComment`, `provisionComment` and `readComment`, each
  defaulting to `comment`, so the generic case is still one string and an override changes
  exactly one object:

  ```ts
  provisionBootstrap({
    role: 'LXCProvisioner',
    groupComment: '', // live: no comment at all
    readComment: 'mint target: read (ops)', // live: its own wording
    provisionComment: 'mint target: provision (ops)', // the one new object
  });
  ```

  The script then prints `group hf-mint: ok` and `user hf-read@pve: ok` and its only writes
  are the role, the new user and its grant. A test runs exactly that against the CLI fake,
  with the one-shared-comment run beside it as a negative control.

  Also:

  - Each comment is checked like `comment` was, and a problem is **named by where the value
    came from** — a bad shared `comment` is still one problem called `comment`, not three
    called after overrides the caller never passed.
  - `readComment` goes with its lane: a `null` `readUser` drops the user, so the field is
    neither used nor checked.
  - `:` joins the characters a comment may hold. It is special in neither `sh` nor a Perl
    `q{}`, and it is how real mint-user comments are written (`mint target: read`).
  - `CoreProvisionNames` is the six names `PROVISION_DEFAULTS` resolves, split out so that
    type keeps its exact shape; `ProvisionNames` extends it. `ProvisionComments` is the
    resolved comment per object. Both are exported.

- [#102](https://github.com/taslabs-net/homeflare-kit/pull/102) [`4fb005e`](https://github.com/taslabs-net/homeflare-kit/commit/4fb005e4892f34bbcef01c5227d464ae36e80299) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Vendor schema constraints, generated and enforced at plan time. `homeflare-proxmox`'s first
  `deploy:pbs` adopted ten objects and then failed its one create on `PVE POST config/verify -> 400:
parameter verification failed - comment: value may only be 128 characters long`. Nothing local
  caught it, because the only place the number 128 existed was PBS's published schema: the generated
  types keep `type`, `enum` and `optional` and drop every `maxLength`, `minLength`, `minimum`,
  `maximum` and `pattern` the vendor states.

  A new `codegen/` reads the cluster's own `apidoc.js` and emits machine-readable constraint tables
  (`packages/alchemy/src/proxmox/generated/constraints/`, one file per vendor area, all inside the
  250-line house cap). `constraints.ts` is a pure validator over a form and its endpoint's table, and
  `resource.ts`'s shared `pveHandlers` runs it on both the create form and the update form — so every
  family that declares an `endpoint` gets it, with no per-resource copy. `Pbs.Datastore`, which writes
  its own handlers, gets the same check through `pbs-datastore-endpoint.ts`. Nineteen families are
  wired, covering 37 endpoints: PBS datastore/prune/sync/verify/matchers, PVE acl, groups, roles,
  users, backup, firewall aliases, HA resources and rules, matchers, replication, SDN vnets and zones,
  pools and storage. Presence of a vendor-required parameter is checked on CREATE only — an update
  form is partial by design.

  Provenance is committed with it. `codegen/manifest.json` records each schema's vendor, product,
  version as the host reports it (pve-manager 9.2.11, proxmox-backup-server 4.2.6-1), source host
  ROLE and absolute path, sha256, byte size and fetch time; every generated header names its manifest
  entry, version and sha256 prefix. The raw 5.8 MB blobs stay out of git in a documented cache
  directory, and the generator refuses to run when a cached file's sha256 does not match.
  `tests/schema-manifest.test.ts` recomputes the tables' digest on every run and, when the cache is
  present, runs `bun codegen/constraints.ts --check` so a stale generation fails with the exact
  refresh command. The two UniFi OpenAPI documents (Network 10.4.57, Site Manager 1.0.0) are recorded
  as available and consumed by nothing — there is no UniFi provider family yet.

  ⛔ Patterns are translated through a whitelist, not copied. Measured over both whole schemas: PBS
  prints its Rust regex through `Display`, so every PBS pattern arrives wrapped in slashes, and it
  uses POSIX classes — `new RegExp` accepts `/^[[:^cntrl:]]*$/` and `[[:^cntrl:]]` SILENTLY and means
  something else in both cases, which would have refused every legal comment. PVE's `(?^:…)` throws.
  Anything the whitelist cannot carry over faithfully is recorded verbatim as `patternSource` and left
  unenforced, including PVE's 216 server-side `format` validators and PBS `schedule`, which publishes
  no pattern at all.

  `resource.ts` is split: the `PveSpec` shape and its argument move to `resource-spec.ts` (re-exported,
  so no importer changes) to keep both files inside the house cap.

### Patch Changes

- [#103](https://github.com/taslabs-net/homeflare-kit/pull/103) [`173b736`](https://github.com/taslabs-net/homeflare-kit/commit/173b7365742921bfde6f3a3114fca22ff7978c46) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Proxmox.Lxc`'s guide now says what a container's **inside** is, and pins it with a test.

  `Proxmox.Lxc` declares the keys in `/nodes/{node}/lxc/{vmid}/config` and nothing within the guest's
  filesystem. Every consumer that meets that limit goes looking for the resource that must surely
  exist — an exec, a file write, a cloud-init. **For containers it does not exist in PVE's API at
  all.** QEMU VMs have `POST …/qemu/{vmid}/agent/exec`, `…/agent/file-write`, `…/agent/file-read` and
  a `cloudinit` subtree; the complete `/nodes/{node}/lxc/{vmid}/…` endpoint set has no counterpart.
  The only reach inside is `termproxy` / `vncwebsocket`, an interactive console for a person.

  - `docs/proxmox-lxc.md` gains that table under **Gaps**, and says plainly that a generic,
    vendor-API-based Resource for a container's interior cannot be written: there is nothing to
    wrap. What is left, in the order that keeps a change declarative — bake it into the template
    (⚠️ `ostemplate` is create-only, so changing it REPLACES the guest), a first-boot artifact, or a
    recorded one-time human step named as undeclared.
  - ⛔ It also says why an exec-over-SSH resource is not option zero: it needs a credential and a
    network path _to the guest_, so when the guest is what provides credentials, naming or reach to
    others, it inverts the bootstrap — the new system's first boot depends on its own output. The
    `HostRunner` seam in `@homeflare/alchemy/launchd` is where such a runner plugs in, and the kit
    ships only `localRunner()` and `sudoRunner()` on purpose.
  - ⚠️ **Sibling families are not at parity.** QEMU and LXC sit under the same `/nodes/{node}/…` tree
    with completely different reach; the guide now says not to infer one from the other.
  - `src/proxmox/lxc-interior.test.ts` checks this against the generated schema on every run, so it
    fails the day PVE adds such an endpoint — which is exactly when the kit would want to wrap it.
    Its positive control asserts QEMU's three are present, so a change to the generated file's shape
    fails the test instead of making every absence assertion pass for free.

  Docs and a test only. No resource, type or behaviour changed.

- [#105](https://github.com/taslabs-net/homeflare-kit/pull/105) [`b1e4af3`](https://github.com/taslabs-net/homeflare-kit/commit/b1e4af38b2bf71986bb8b85974aa432e3b30ec99) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Generated Proxmox API coverage report, with provenance.

  `docs/api-coverage.md` and `docs/api-coverage.json` map every PVE and PBS endpoint that can
  create, update or delete state to the Resource that owns it, or to nothing — derived from the
  vendor schemas named in `schemas/manifest.json` (product version, source host role, sha256, size,
  fetch time), not hand-counted. PVE `pve-manager/9.2.4/5e5ae681198514d4`: 88 of 335 write
  endpoints owned. PBS `proxmox-backup-server 4.2.6-1`: 27 of 182.

  Each row also names the parameters carrying a vendor `maxLength`, `minLength`, `minimum`,
  `maximum`, `pattern` or `format` that nothing local enforces — 545 on the PVE endpoints we own and
  144 on the PBS ones, including the `comment` on `POST /config/verify` whose 128-character limit
  failed a `Pbs.VerifyJob` create at apply time.

  Regenerate with `bun run api:coverage`; `--check` exits 1 when the committed report is stale.
  `tests/api-coverage.test.ts` fails if a Resource claims an endpoint the schema no longer has, if a
  path the source calls unreachable turns out to exist, or if the report has been hand-edited. No
  package code changed.

## 0.14.0

### Minor Changes

- [#98](https://github.com/taslabs-net/homeflare-kit/pull/98) [`89ce4fd`](https://github.com/taslabs-net/homeflare-kit/commit/89ce4fdf606d6cc6e635164f0413b4ca6187379f) Thanks [@taslabs-net](https://github.com/taslabs-net)! - **New subpath: `@homeflare/alchemy/github` — one repository's merge policy in one call.**

  - `declareRepoPolicy(id, options)` declares a `GitHub.Repository` and a `GitHub.Ruleset` over its
    default branch: squash-only merges, auto-merge, head branches deleted on merge, no branch
    deletion, no force pushes, and the status-check contexts you name required with
    `strict_required_status_checks_policy` off. Both resources retain; `adopt` is piped only when
    asked. Generic and parameterized — `rulesetName`, `include`/`exclude`, `bypassActors`,
    `enforcement`, `baseUrl` (applied to both resources or to neither), and a `settings` bag for
    everything that is not merge policy, merged underneath so it cannot re-open a merge method.
  - `repoPolicy(options)` is the same policy as two plain prop objects, pure and type-only, for a
    test or a stack that wants to declare the resources itself.

  What it refuses, because each of these failures is silent:

  - ⛔ **Auto-merge with nothing to wait for merges the pull request immediately.** Auto-merge is
    a queue only while something is outstanding, and three inputs produce "nothing
    outstanding": no `checks` and no `requiredApprovals`; an `enforcement` that is not `active`
    (the rules are listed and none of them block); and an explicitly empty `include` (the ruleset
    matches no ref while GitHub still shows it as active). A required review counts as outstanding,
    so `requiredApprovals` with an empty `checks` is allowed. `checks: []` alone is accepted only
    alongside `autoMerge: false` — the honest description of a repo with no green run to require yet.
  - ⛔ **A blank check context** is refused: GitHub stores it and no job ever reports it, so every
    pull request waits on a check that cannot come.
  - ⛔ **`requiredApprovals: 0` is refused rather than treated as "no reviews".** Zero approvals is
    the solo-maintainer shape and needs `require_extra_approval_for_unattributed_changes: false`,
    which `alchemy@2.0.0-beta.79`'s `Ruleset` cannot send and GitHub defaults to `true`. Omitting
    `requiredApprovals` declares no `pull_request` rule at all, which is a different and honest
    thing.

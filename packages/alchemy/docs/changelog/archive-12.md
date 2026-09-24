# Alchemy changelog archive 12

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

1. `R2BucketLock` uses `Effect.orDie` and `Effect.promise`. Its reconcile trusts `output`
   rather than the live lock, and it sits on a second Cloudflare SDK where
   `@distilled.cloud/cloudflare/r2` already has the lock operations.
2. `forgejo/client.ts` is hand-rolled, while `@distilled.cloud/forgejo@1.0.0-rc.12` is
   generated against Forgejo 16.0.3.
3. `MeshNode` is a deliberate twin of `Cloudflare.Tunnel.WarpConnector`.
4. Shipped provider code calls `Bun.*` or the `node:*` modules upstream bans (14 of 17
   listed files; the other 3 use only synchronous `node:crypto` or `Buffer`, which upstream
   allows inside `Effect.sync`), and 51 test files run on `node:test` instead of
   `bun:test`.

What the ledger records is the gap for each finding. It changes nothing.

## 0.19.1

### Patch Changes

- [#128](https://github.com/taslabs-net/homeflare-kit/pull/128) [`ba55148`](https://github.com/taslabs-net/homeflare-kit/commit/ba5514820e32f9d546f1a5eb0f92c7f156f2a978) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Estate topology out of the constraint proofs. PR [#118](https://github.com/taslabs-net/homeflare-kit/issues/118)'s create-form proofs used the real
  declarations verbatim, which put a metrics hostname, a cluster's `api-path-prefix` and three Ceph
  pool names into `src` — and `src` ships in the npm tarball of a public repository, so they would
  have stayed in the git history forever. `lxc-harness.ts` states the rule and these tests did not
  follow it: a production-SHAPED declaration with placeholder values, because the proof is about
  which keys the create form sends and which bounds they face, never about the strings.

  No behaviour changes; the same forms are checked against the same tables.

- [#136](https://github.com/taslabs-net/homeflare-kit/pull/136) [`64d4c36`](https://github.com/taslabs-net/homeflare-kit/commit/64d4c36091054fa05b716f1d4029c1feea955289) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Check a systemd rename at plan time. A unit's name or directory change is a delete-first replace, and Alchemy deletes the old unit before reconciling the new one, so a masked name, a unit file someone else owns, or a runner that will not write the new path used to be noticed only after the old unit was already stopped. Those checks now run while planning, and again at apply when the new name was still an Output and the diff could not see the rename. A file byte-identical to this declaration's render stays exempt: it is a deploy that died between write and reload.

## 0.19.0

### Minor Changes

- [#120](https://github.com/taslabs-net/homeflare-kit/pull/120) [`512bf1a`](https://github.com/taslabs-net/homeflare-kit/commit/512bf1a6a973bdbd1c9688d295dcf8a067820a36) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Linux hosts on the existing HostRunner seam: `@homeflare/alchemy/linux`.

  The kit could declare a guest and nothing inside it. This adds the families that gap
  was missing, on the same seam the launchd subpath already drives a Mac through — so
  `HostFile`'s ownership rules, `checkWrite` and the adoption doctrine come along unchanged.

  - `sshRunner({ host })` — a Linux `HostRunner` over the operator's own ssh config.
    ⛔ `BatchMode=yes` and host verification untouched; ⛔ every remote script reports its
    status behind a per-runner nonce, so a dropped connection is an Error and never a
    "nothing is there"; ⛔ `privileged: false` — nothing calls sudo.
  - `HostDirectory` — because no file resource creates a parent. One directory, never a
    chain; delete is `rmdir`, never recursive.
  - `RemoteFile` — a whole file, or one MANAGED REGION (`BEGIN`/`END` markers) inside a
    file this resource does not own. ⛔ Every byte outside the markers stays identical, the
    file's own mode and owner are copied back, and a delete removes only the block.
  - `SystemdUnit` / `SystemdTimer` — unit file, `daemon-reload`, enable/disable,
    start/stop. ⛔ A deploy NEVER mass-restarts: a unit restarts only when its own file
    changed, when state or systemd says the loaded copy is stale, or when a digest the
    declaration listed in `restartOn` changed. An adopted unit that already matches is not
    restarted, reloaded or started.

  `systemctl` and `stat` shapes measured read-only on Debian 13 / systemd 257, 2026-09-22;
  the write subcommands are reasoned and read back rather than assumed. Unit files render
  verbatim — there is no machine-readable directive schema to generate from, so the kit
  invents none. Guide: `docs/linux-host.md`.

## 0.18.0

### Minor Changes

- [#118](https://github.com/taslabs-net/homeflare-kit/pull/118) [`5ae4e91`](https://github.com/taslabs-net/homeflare-kit/commit/5ae4e91919a101da3d8605a069c65e0301d0cccc) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Every Proxmox family that writes to the vendor is now checked against the vendor's own schema —
  35 of 35, up from 19, covering 75 endpoints instead of 37. A family left unwired was a write this
  package made with nothing between the declaration and the server's 400, which is the shape of the
  2026-09-22 `deploy:pbs` incident this feature exists for.

  Newly wired: `Proxmox.ApiToken`, `CephDaemon`, `CephFlag`, `CephFs`, `CephOsd`, `CephPool`, `Lxc`,
  `MetricServer`, `NetworkApply`, `NodeNetwork`, `NotificationTarget`, `SdnApply`, `SdnSubnet`, `Vm`,
  `ZfsPool`, and `Pbs.NotificationTarget` — which was missing from the sweep list and carries the
  incident's own rule, `comment: maxLength 128`, on all three of its creates. Families that write
  their own handlers (`CephOsd`, `Lxc`, the two applies, `Pbs.NotificationTarget`) reach the same
  check by name through `guardForm`, as `Pbs.Datastore` already did; families with a spec declare
  `endpoint`. `tests/constraint-wiring.test.ts` derives the census from the ownership ledger, so a
  family added without an endpoint fails there rather than on a deploy, and each newly wired family
  has a proof test that runs its REAL create form through the vendor's create table and requires no
  violations.

  🔴 **A live bug this found.** `Proxmox.NodeNetwork`'s create form never sent `iface`, which PVE
  marks required on `POST /nodes/{node}/network` while `{node}` is its only path parameter. Every
  interface create this package could have made would have 400ed; nothing caught it because the
  estate's interfaces were all adopted, which takes the PUT path. `createBody` now sends it, and the
  PUT still does not — there `iface` is the path.

  ⛔ **Presence of a vendor-required parameter is now demanded only when a create is really about to
  happen**, not whenever the create form is built. `Proxmox.NotificationTarget` cannot send gotify's
  `token` or smtp's `password` — they are write-only secrets and props are persisted unencrypted — so
  the documented workflow is to create the target out of band and then declare it. Under the old
  unconditional check that adopt-then-update would have been refused forever; now it plans clean,
  while asking to CREATE a gotify target fails at plan with PVE's own `token: required`. The guards
  move into `resource-guard.ts` and are exported from `pveOperations`, so `CephPool`'s hand-written
  reconcile gets them too.

  An **action** endpoint with no form is wired as well (`PUT /cluster/sdn`, `PUT /nodes/{node}/network`):
  the table is empty, but the key is resolved against the vendor schema at generation time, so a PVE
  that moves or withdraws an apply fails `bun run check` instead of an `ifreload -a` on three nodes.

  `PveSpec['endpoint']` now also admits a function of props, for the two families whose endpoint is
  chosen by a prop — `NotificationTarget`'s four PVE types and `CephDaemon`'s mds/mgr/mon, each with
  its own parameter schema. Every key it can return is still a literal in this package's source,
  because the generator finds endpoints by scanning text.

  Generator changes that came with the volume: `/cluster` and `/nodes/{node}` are split one level
  further down, because they are routes rather than areas — PVE's own viewer expands them — so the
  tables are now 18 files (`pve-cluster-sdn.ts`, `pve-nodes-ceph.ts`, …), all inside the 250-line
  house cap. The generator deletes a file it no longer produces, `tests/schema-manifest.test.ts`
  enumerates the directory instead of a hand-written list and checks every table is claimed by the
  manifest entry it came from, and two PVE bounds published as JSON strings (`bwlimit`'s
  `minimum: "0"`, `count`'s `maximum: "16777216"`) are parsed to numbers — a faithful reading of a
  stated value; a bound that is not a number at all is still dropped rather than guessed at.

## 0.17.0

### Minor Changes

- [#114](https://github.com/taslabs-net/homeflare-kit/pull/114) [`3316006`](https://github.com/taslabs-net/homeflare-kit/commit/3316006513196622551d4cc041986089dc28ffc4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The Proxmox API type generator, written from the vendor schemas, and the widening it removes.
  `packages/alchemy/src/proxmox/generated/{pve,pbs}.ts` carried the header
  `Run: bun codegen/generate.ts` from the day they were committed, and
  `git log --oneline --all -- 'codegen/generate*'` is empty at every commit: that file existed
  nowhere. The mapping was therefore readable only as its own 8,196 lines of output — nobody could
  reproduce it, correct it, or say which schema version it described. Because nobody could read it,
  nobody noticed what it did: it kept `type`, `enum` and `optional`, dropped every `maxLength`,
  `minLength`, `minimum`, `maximum`, `pattern`, `format`, `typetext`, `default` and description, and
  covered 407 of PVE's 678 endpoints and 46 of PBS's 367 with no record of which 407 or why.

  `bun codegen/types.ts` is that generator, with `--check`, the same manifest and the same
  sha256-as-identity rule as `codegen/constraints.ts`. It emits every endpoint both products
  document — 678 PVE and 367 PBS, 1,619 exported types — split across 89 files by the vendor's own
  path and packed back up so the split is no deeper than the 250-line house cap requires. Every file
  names its manifest entry, the product version the host reported and the sha256 of the bytes it was
  read from. `generated/pve.ts` and `generated/pbs.ts` stay as `export *` barrels, so no import in
  this package or any consumer moves.

  ⛔ **An integer request parameter is `` `${number}` ``, not `string`.** `pbs:POST /config/verify`'s
  `max-depth` is `integer, minimum 0, maximum 7` in PBS's schema and was `'max-depth'?: string` in
  the type, which accepts `'banana'`; 480 PVE and 151 PBS parameters were widened that way. They are
  now the wire spelling of a number: still assignable to `PveForm`, still carried unchanged through
  `violations`' bound check, and no longer satisfied by an arbitrary string. It is deliberately NOT
  `number`: `client.ts` sends `application/x-www-form-urlencoded` and types the body
  `Record<string, readonly string[] | string>`, so a `number` could not be handed to `pve()` at all,
  and `constraints.ts` iterates a form value on `typeof value === 'string'`. ⚠️ `String(n)` does not
  typecheck against it — write `` `${n}` ``. A boolean parameter stays `'0' | '1'`, which is the
  encoding `values.ts`'s `flag()` already produces rather than a widening. Responses are JSON and
  keep their real `number` and `boolean | 0 | 1`.

  The old output is reproduced before it is changed, which is what makes the diff reviewable: run
  against the same two schemas with integers left widened, the pipeline re-emits all 646 PVE and 69
  PBS declarations identically, with two recorded exceptions — `NodesNodeLxcVmidConfigGetReturn`'s
  `lxc` becomes `readonly (readonly string[])[]` rather than a readonly array of mutable ones, and 21
  declarations break lines differently because `oxfmt` had reformatted the committed files before
  every `generated` directory reached its ignore list. The naming is the old generator's, reproduced
  rather than improved: `ClusterBackupIdIncluded_volumesGetReturn` keeps its underscore, because
  renaming sixty exported types in the commit that changes what the types mean would hide the second
  change inside the first.

  ⛔ Parameter schemas wrapped in `allOf`/`oneOf` are read through `codegen/parameters.ts` (PR [#113](https://github.com/taslabs-net/homeflare-kit/issues/113)),
  not asked for as `parameters.properties`. `POST /cluster/ha/rules` and `PUT /cluster/ha/rules/{rule}`
  are the two PVE endpoints that need it; a reader that misses them emits a type with no fields, which
  is indistinguishable from an endpoint that takes nothing. An unresolvable schema gets a doc comment
  naming the construct and **no** `Params` type — neither product needs that on these versions.

  ⛔ "Closed object" is spelled differently by the two products, and a test for one lies about the
  other. Measured over both whole schemas: PVE writes numbers (`additionalProperties: 0` on 617
  objects, `1` on 21, absent on 352), PBS writes booleans (`false` on 560, `true` on 36). An absent
  `additionalProperties` is open — the vendor never promised the list was exhaustive.

  ⛔ Eight PVE files are over the house cap and cannot be split. Each holds the endpoints of one
  vendor path whose parameters carry enums of hundreds of members — `rootfs`, `mp0`…`mp255`,
  `unused0`…`unused255` for the volume moves, the ACME DNS provider list, the QEMU CPU model list. A
  single type declaration is the smallest unit there is; dropping the enum would widen the parameter
  back to `string`. Each says so in its own header and `tests/schema-types.test.ts` pins the list.

  `tests/schema-type-mapping.test.ts` holds the mapping to shapes lifted from the committed files and
  needs no schema cache, so it runs on CI. `tests/schema-types.test.ts` checks provenance, the
  barrel against the files on disk, the cap, the coverage counts and five endpoints the old generator
  omitted, and runs `bun codegen/types.ts --check` when the cache is present — skipping with the
  refresh command when it is not. `codegen/TYPES.md` carries the reasoning.

## 0.16.1

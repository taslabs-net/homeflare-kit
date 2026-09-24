# Alchemy changelog archive 1

[Current changelog](../../CHANGELOG.md) · [Archive index](./README.md)

## 0.37.0

### Minor Changes

- [#262](https://github.com/taslabs-net/homeflare-kit/pull/262) [`ca1a558`](https://github.com/taslabs-net/homeflare-kit/commit/ca1a558db9101a8381dff57ba80f4aafcd01ae61) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `argocd/*` family — `Argocd.Repository`, `Argocd.RepoCreds` and `Argocd.Cluster`, on
  `@distilled.cloud/argocd@1.0.0-rc.12` (measured published, matching the kit's own `effect`/core
  pins — added as a direct peer dependency, the same shape as `forgejo`/`discord`). Built ahead of
  need, per Tim's "we are using talos on pve once we get things settled ... i thought we are using
  argocd, i wanted it on the radar" and "even if we don't use it yet but we know we will" — **no
  Talos-on-PVE cluster and no Argo CD instance exist on the estate yet**; every test runs against a
  fake, never a real server.

  **Upstream check first (decision 49).** `alchemy-run/alchemy` v2.0.0-beta.79 ships no ArgoCD
  provider at all — the only two `argocd` hits in the whole repo are an unrelated AWS EKS add-on
  capability name in a JSDoc example. So there is nothing upstream to duplicate.

  **The REST-vs-CRD split is the actual design decision, and it is why `Application`/`AppProject`
  are deliberately NOT in this family.** Both are real Kubernetes CRDs (`argoproj.io/v1alpha1`,
  their own versioned OpenAPI schema, listable with plain `kubectl`) — the upstream-correct owner is
  Alchemy's own `Kubernetes.Manifest` (`src/Kubernetes/Manifest.ts`, which already documents a
  "Custom resource (CRD)" example), not a house REST wrapper around the same object. Repository,
  RepoCreds and Cluster are different: Argo CD's own storage for them is a `Secret` labeled with its
  own private convention (`argocd.argoproj.io/secret-type: repository|repo-creds|cluster`) — not a
  published Kubernetes API type, so the REST SDK is the only correct owner. Full reasoning, citations
  and worked `Kubernetes.Manifest` examples for `Application`/`AppProject`:
  `packages/alchemy/docs/argocd.md` and `docs/argocd-kubernetes.md`.

  **A real, measured SDK-gap check that came back clean, unlike Discord's.** No `patches/` directory
  exists for `packages/argocd` in distilled (homeflare/base) — every generated operation's own
  declared `errors` array is just `[UnknownArgocdError]`. That looks like Discord's documented gap
  (`docs/discord.md#sdk-gaps`) at first read. It is not: `protocol.ts` types every operation's shared
  error channel from `API_ERRORS` (the full `HTTP_STATUS_MAP` set, not the narrower
  `DEFAULT_ERRORS` Discord's channel is built from), and `core/protocol-rest.ts#decode` maps any
  4xx status through `HTTP_STATUS_MAP` unconditionally after the per-op typed matchers, regardless
  of what the operation itself declared. `catchTag('NotFound', ...)` works correctly today — proven
  against the real protocol and a fake 404/401/403 in `repository.test.ts`, `repo-creds.test.ts` and
  `cluster.test.ts`, not asserted by reading the source alone. No distilled patch was needed.

  **Secrets never in state.** Every credential field (a repo's password/SSH key/bearer token/TLS
  client key, a cluster's password/bearer token/TLS client key) is a prop typed `FromEnv`
  (`../secrets/write-only.ts`), resolved from the deploying process's own environment at call time
  and refused with a typed domain error when unset — never a literal value on a stack file, an
  attribute, or in Alchemy's state store. No drift detection on those fields, the same
  simplification `forgejo/org-actions-secrets.ts` already makes for the identical problem (Argo CD's
  `Get`/`List` never returns them back): written once on create, rotated by destroy-then-create.

  **Shape.** One shared engine (`resource.ts`) — a near-verbatim copy of `forgejo/resource.ts`, since
  both SDKs are plain bearer-REST with a genuine typed `NotFound`. `reconcile` is a single upsert
  call (every `Create*` operation this family calls takes `upsert: true` as a query parameter,
  converging create-or-update in one request — no separate `Update*` path to wire). No `adopt(true)`/
  `Unowned` wrapping, mirroring forgejo's own choice rather than discord's/netbox's marker.

  **Tests**: 20 cases across the three resources, covering a live decode, a 404 folding to absent, a
  401/403 propagating (never folded), idempotent delete (no DELETE call against an already-absent
  object), and the write-only credential refusal/resolution path — all against `fake-argocd.ts`, a
  loopback fake exercising the real distilled protocol, never a real Argo CD server.

### Patch Changes

- [#259](https://github.com/taslabs-net/homeflare-kit/pull/259) [`4302d28`](https://github.com/taslabs-net/homeflare-kit/commit/4302d28be200a04aa7b367a8a579134f864cd414) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `proxmox/*` family's Ceph sub-area, second of two PRs for 2c (decision 43's walk-down): migrates
  `Proxmox.CephDaemon` (mon/mgr/mds) and `Proxmox.CephOsd` fully onto `@distilled.cloud/proxmox`.
  Neither family had a forked-worker settle loop or an envelope-stripping dependency, so unlike
  `Proxmox.NetworkApply`/`Proxmox.CephFs`'s delete, there is no protocol-level reason to leave either
  on `client.ts` — both move completely.

  **`Proxmox.CephDaemon`** replaces the generic `pveOperations`/`pveHandlers` factory (which cannot
  run a distilled typed operation) with hand-written `read`/`diff`/`reconcile`/`delete`, matching the
  factory's own pre-migration shape exactly: `matches` was always `() => true` and there is no PUT
  for any of the three kinds, so a live daemon is always `noop` and drift is always `update`, never a
  diff no write could satisfy. `nodes.updateNodeCephMon`/`Mgr`/`Mds` are distilled's generator
  misnaming the create a POST "update" (checked against each one's `T.Http` annotation before
  trusting the name); `nodes.listNodeCephMon`/`Mgr`/`Mds` and `nodes.deleteNodeCephMon`/`Mgr`/`Mds`
  are the read and delete. One field rename: mon's `mon-address` maps to distilled's `mon_address`
  (`T.Body("mon-address")`, confirmed against the schema) — the same one-key pattern
  node-network-form.ts's `RENAMED` table carries for three fields.

  **`Proxmox.CephOsd`** keeps its own pre-migration read behaviour exactly: `readOsd` (ceph-osd-tree.ts)
  still has NO `Effect.orElseSucceed` — the tree endpoint is a collection that always exists while
  Ceph is installed, so a read failure is never "the OSD is gone" and must propagate, never fold. This
  is the one migrated Ceph family that does NOT match the single-fold shape `Proxmox.CephPool`/
  `Proxmox.CephDaemon` carry, because it never had it before this PR either. `nodes.getNodeCephOsd`
  (the tree), `nodes.createNodeCephOsd` and `nodes.deleteNodeCephOsd` map 1:1 to the existing forms.

  **Both families keep every existing refusal byte-for-byte.** `Proxmox.CephOsd`'s create and delete
  remain unreachable through this package's own credential — PVE registers `createosd`/`destroyosd`
  with NO permissions block at all (root@pam only), confirmed again against distilled's own generated
  schema, which changes nothing about that restriction. `Proxmox.CephDaemon`'s destroy still runs
  against the daemon's own id path, never the collection `read` uses, avoiding the 501-that-looks-
  like-a-permission-problem the pre-migration header already warned about.

  **One pre-existing, out-of-scope finding, carried forward exactly rather than fixed here:**
  `Proxmox.CephOsd`'s `destroyOsd` sends its `cleanup` flag as a request BODY on a DELETE, on
  `client.ts` before this PR and on distilled after it alike — `client.ts`'s own `buildRequest` puts
  `form` in the body for every HTTP method, and distilled's generated `DeleteNodeCephOsdRequest`
  carries no `T.Query()` annotation on `cleanup` either, so it defaults to the same place. PVE's own
  server (measured from `AnyEvent.pm`, the same fact `Proxmox.CephFs`'s delete was kept off distilled
  for) never reads a body on DELETE — so `cleanup=1` was ALREADY silently ignored by the live cluster
  before this migration. This is not a new regression, so it is not a reason to keep `destroyOsd` off
  distilled the way `Proxmox.CephFs`'s delete was — but it is a real bug, unrelated to this PR, flagged
  separately for its own fix (move `cleanup` into the query string, the way `destroyPath` in
  ceph-fs-wire.ts already does for CephFs's own flags). It has zero live impact today either way,
  since the whole DELETE 403s for this package's credential regardless of `cleanup`.

  **One adversarial-review finding, fixed.** The hand-written `reconcile` returned early on
  `if (live !== undefined) return live;` BEFORE calling `guardWrite` — the pre-migration factory
  (`pveOperations.reconcile`, resource.ts) ran its create/update guard unconditionally right after
  the read, because `reconcile` also runs for an ADOPTED row with no fresh `diff` first (Plan.ts
  forces it after the probe even when `diff` said noop). Inert today, since `diff` guards every
  normal plan — but a real gap for any caller that invokes `reconcile` directly (a resumed apply
  from persisted state, a verify/adopt harness). Fixed to match `node-network.ts`'s own `reconcile`:
  `guardWrite` now runs immediately after the read, unconditionally. `reconcileDaemon` is exported
  so a test can call it directly, bypassing `diff` the same way the gap would have been reached.

  **A related, separate finding, NOT fixed here — recorded to `decisions.md`'s open items.** Proving
  the guard fix with an actual refused value turned up that `constraints.ts`'s `violations()` never
  checks a bare `format` rule: `mon-address`'s own vendor entry is `{"format":"ip-list",
"type":"string"}` with no `pattern`, and checked directly, `formViolations` returns `[]` for a
  malformed address. `mds`/`mgr`'s create endpoints carry EMPTY constraint tables too. About 105
  parameters across this whole package declare a `format`; none are enforced. This is a real,
  pre-existing gap unrelated to distilled or this migration — the new test instead proves the
  STRUCTURAL property (`guardWrite`, and the `createForm` it must evaluate, still run on the
  adopted-row path, via a field getter that only `createForm` reads on that path), confirmed to fail
  without the ordering fix by temporarily reverting it and re-running.

  **New tests**, proven against a deliberately broken implementation before landing:
  `ceph-daemon-write.test.ts` (a new mon POSTs `mon-address` as `mon_address` and reads the collection
  back; a new mds POSTs `hotstandby`; `RemovalPolicy.destroy()` then undeclaring a mgr sends exactly
  one DELETE — confirmed to fail without the real `deleteDaemon` call by temporarily stubbing it out)
  and `ceph-osd-write.test.ts` (a new OSD POSTs `dev` and `crush-device-class` correctly and reads the
  new leaf back by id — this test can never run against the real cluster, since the write it drives is
  root-only, but it is the only way to catch a wire-translation bug a real deploy would never reach far
  enough to expose).

  **Expected after this releases and the consumer bumps:** no live plan change for either family — C1's
  read-role lease could always read the live Ceph daemons and OSDs cleanly, so this is a transport
  migration on tested paths, not a behaviour change.

- [#257](https://github.com/taslabs-net/homeflare-kit/pull/257) [`5e1e1b7`](https://github.com/taslabs-net/homeflare-kit/commit/5e1e1b7dfd51cff7664c74284287e44e9caa9f3c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - The `proxmox/*` family's Ceph sub-area, first PR of two (decision 43's serial proxmox walk-down,
  2c — the four Ceph families, split pool+fs first, daemon+osd after): migrates `Proxmox.CephPool`
  fully onto `@distilled.cloud/proxmox`, and migrates `Proxmox.CephFs`'s READ and CREATE onto it
  while its DELETE stays on `client.ts` for a measured protocol reason.

  **Every existing refusal and guard survives byte-for-byte — this is a transport swap, not a
  redesign.** Both families keep the exact single-fold read shape they always had
  (`Effect.orElseSucceed` after every failure, no `output`-branching): that is NOT the newer
  dual-path pattern `Proxmox.NodeNetwork`/`Proxmox.ZfsPool`/`Proxmox.Storage` carry, and it is not
  upgraded to it here — this PR's own rule is behaviour surviving unchanged, not gaining the newer
  pattern along the way. Both `ceph-pool-wire.ts` and `ceph-fs-distilled.ts` say so in their own
  headers, including the same-day latent gap this leaves (a refused OpenBao mint still folds to
  "absent" on both families, the cries-wolf class already fixed elsewhere) — noted, not fixed, since
  fixing it is a behaviour change this PR's rules do not ask for.

  **`Proxmox.CephPool`: the PG-merge guard, and the absence signal, both measured live.** `GET
/nodes/{node}/ceph/pool/{name}/status` on a name with no pool answers a generic HTTP 500 (measured
  against TB4 `n2`, 2026-09-24, read-role, read-only probe:
  `{"data":null,"message":"error with 'osd pool get': mon_cmd failed - unrecognized pool
'<name>'\n"}`) — not a parsed field like `Proxmox.NodeNetwork`'s 400, so `confirmAbsent`
  (ceph-pool-settle.ts) still asks the SECOND question — does the index list this name — before a
  create is allowed to run, exactly as before. `confirmAbsent` now calls distilled's
  `listNodeCephPool`; the settle loop (waiting out a forked worker) never used PVE's task-status
  endpoint at all — it re-polls the pool's own status, so it needed no `Task.awaitTask` and carries
  no NEW protocol risk. `createNodeCephPool`/`putNodeCephPool`/`deleteNodeCephPool` map 1:1 to the
  existing form (no field renames this family needed).

  **`Proxmox.CephFs`: reads and create move; delete does not, for a measured reason.** Distilled
  types `DeleteNodeCephFsRequest`'s `remove_pools`/`remove_storages` as request-BODY fields
  (`T.Body`) — checked directly against its generated schema. This family's own header already
  carries the measured fact (from PVE's own `AnyEvent.pm`) that PVE's server reads a request body
  only on PUT/POST; a DELETE's body is silently discarded, no error raised anywhere. Sending those
  two safety flags through distilled's generated delete op as-is would silently drop them — the same
  class of protocol gap `Proxmox.NetworkApply` was kept off distilled for. `destroyFs` therefore
  stays on `client.ts`, unmigrated, in `ceph-fs-wire.ts`.

# @homeflare/alchemy

Earlier releases: [changelog archive](./docs/changelog/README.md).

## 0.41.0

### Minor Changes

- [#313](https://github.com/taslabs-net/homeflare-kit/pull/313) [`f167fd2`](https://github.com/taslabs-net/homeflare-kit/commit/f167fd2a3e152462dc9da579ca92263aa695a558) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Host.Directory's chmod/chown no longer decide whether to pass `--` by the OS of the machine running Alchemy. They now read the target's own platform from `HostRunner.platform` — a new field every `HostRunner` declares (`localRunner()`, `sshRunner()`, `sshSudoRunner()`, and any consumer's own runner).

  Deploying from a Mac to a Linux host over `sshSudoRunner` (homeflare-ct100, 2026-09-27) dropped GNU's required `--` because the old check read `process.platform`, the Mac's own OS, and the sudo allowlist refused every chown with `SudoRefusedError` even though the path was under a declared prefix. `localRunner()`'s own local deploys never showed this, because there the target and the calling process are the same machine.

  A custom `HostRunner` implementation now needs to declare `platform: 'darwin' | 'linux'`.

### Patch Changes

- [#264](https://github.com/taslabs-net/homeflare-kit/pull/264) [`a2a4818`](https://github.com/taslabs-net/homeflare-kit/commit/a2a4818226d2c672c3a96132231f8ff09ae2cbf4) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Compatibility fix for the already-merged `opnsense/*` family (PR [#236](https://github.com/taslabs-net/homeflare-kit/issues/236)),
  made necessary by this PR's `@homeflare/distilled-opnsense` SDK bump: the
  whole-model `get()` this family's `Opnsense.Firewall.Alias`/`Opnsense.Firewall.Group`
  `fetchLive` reads now correctly decodes list-shaped fields (`type`,
  `interface`, `proto`, `categories`, `members`, `content`) as OPNsense's
  real option-map shape `{key: {value, selected}}`, not a string — see the
  SDK PR's OPNSENSE-2 fix.

  This surfaces (and fixes) a real, previously-masked bug rather than
  introducing one: `alias-form.ts`'s old `csvSet(live.categories)` called
  `.trim()` on what the pre-fix SDK typed as a string — the exact crash
  class the SDK PR's changeset describes for the live homeflare-network
  import — just never hit here because this family's own tests used a fake
  OPNsense returning string-shaped fixtures that matched the bug instead of
  the real wire. `wire.ts`'s new `selectedOf`/`selectedOneOf` extract the
  selected key(s) back to the plain string/string[] shape
  `AliasAttributes`/`GroupAttributes` already declared, so `matches` and the
  declaration renderer (`propsFromLive`) are behaviorally unchanged for any
  already-correct declaration.

  No live-plan impact expected: this is the read path decoding correctly
  for the first time against a real option-map response, not a change to
  what a declaration renders or what `matches` reports for a value that was
  already being read successfully (a value that decoded as `[object Object]`
  or threw before this fix could never have matched a real declaration
  anyway).

  **Still held for the follow-up PR** (per the SDK PR's own note): switching
  `Category`/`Group` to their now-correct per-item `getCategory`/`getGroup`
  (OPNSENSE-1) instead of whole-model `get()`, `catchTag` typed errors, a
  delete-of-absent test and a transient-read-propagates test.

  **The opnsense family is correct for consumers only after the alias pin
  moves to the released `distilled-opnsense`.** `packages/alchemy/
package.json` still pins `"@distilled.cloud/opnsense": "npm:@homeflare/
distilled-opnsense@0.2.0"` exactly — this PR does not bump it. The bun
  workspace links the local package during development, which is why this
  fix's tests and this repo's own pre-push gate pass, but a published
  `@homeflare/alchemy` consumer installs the pinned `0.2.0` from npm, which
  still cannot decode option maps, underneath family code that now expects
  them. Moving the pin is a separate, later PR, once `@homeflare/
distilled-opnsense` has actually released (the same two-step precedent as
  kit commit `06591c9` / PR [#206](https://github.com/taslabs-net/homeflare-kit/issues/206)).

- [#314](https://github.com/taslabs-net/homeflare-kit/pull/314) [`3e9d6f3`](https://github.com/taslabs-net/homeflare-kit/commit/3e9d6f339938e0ead794b98598344c77033fe59e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix `Proxmox.Storage` updates: `reconcile` used to PUT the FULL declared
  form to `/storage/{storage}` whenever anything drifted, including a
  `shared` that already matched what PVE reported live. Measured
  2026-09-27, `bun run deploy`: updating `storage-cephfs-tb4` (only its
  `content` had actually drifted, adding `import` for Talos) failed with
  `InternalServerError: update storage failed: unexpected property
'shared'` — cephfs's own PVE storage plugin never accepts `shared` in its
  `options()` at all (vendor-cited in the new `storage-plugin-options.ts`,
  checked against `github.com/proxmox/pve-storage`, branch `master`,
  2026-09-27), even though the combined `pve-apidoc` schema and distilled's
  generated wire types both carry the field.

  `updateForm` (`storage-form.ts`) now builds a genuinely partial PUT body:
  once a live read exists, only the declared fields that differ from it
  (`storage-wire.ts`'s new `changedProps`, shared with `matches`'s own
  drift check so the two can never disagree) reach the wire, and `shared`
  is additionally gated by a per-type accepted-list (`sharedAccepted`) so
  it is never sent — or compared, which would otherwise make a plan loop
  forever on a field nothing can ever apply — for a type whose plugin
  doesn't accept it. `storage.ts`'s `reconcile` now computes that partial
  form once and passes the same object to both `guardWrite` and the actual
  `putStorage` call, so the vendor-constraint guard always checks exactly
  what is sent.

  New tests (`storage-update.test.ts`, no live PVE): a cephfs storage whose
  only drift is `content` PUTs `content` and nothing else; an
  already-matching storage sends no PUT at all; a `dir` storage (whose own
  `DirPlugin.pm` options() does list `shared`) sends it when it drifts —
  the accepted-type path, contrasted with cephfs's refused one.

  Second pass (same day, a red team on this PR before merge): a declared
  `shared` on a type outside `sharedAccepted` that genuinely disagrees
  with what PVE reports used to vanish into the same skip and plan `noop`
  forever, silently — the recorded attribute stayed whatever PVE already
  had, with no warning. `matches` now dies with a clear message on exactly
  that one case; a matching or undeclared `shared` is unaffected and still
  plans `noop`. Also, `btrfs` and `esxi` were re-checked against
  `github.com/proxmox/pve-storage` (master, 2026-09-27) and do accept
  `shared` in their own `options()` (`BTRFSPlugin.pm:69`,
  `ESXiPlugin.pm:52`) — moved from unverified into `sharedAccepted`, so a
  declared `shared` on one of those two types is sent again rather than
  silently dropped; `iscsi`, `iscsidirect` and the remote-ZFS `zfs` plugin
  are now verified absent rather than unverified.

## 0.40.0

### Minor Changes

- [#306](https://github.com/taslabs-net/homeflare-kit/pull/306) [`d11352c`](https://github.com/taslabs-net/homeflare-kit/commit/d11352c29cb39ea9f1abba5464662b26ee9c4e1b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `@homeflare/alchemy/ceph`: `Ceph.AuthEntity` (K-A4), plus the ssh mon-command transport it
  runs on — built for the Talos-on-PVE ceph-csi entity, per the accepted design
  (`docs/plans/2026-09-26-ceph-mon-transport.md`).

  The PVE API has no `ceph auth` endpoint at all (measured against the pinned schema); this family
  closes that gap over ssh + `sudo -n /usr/bin/ceph`, tried against the declared mon nodes in order,
  behind a client-side argv allowlist of exact shapes — `auth get`, `auth get-or-create`, `auth
caps`, and `config get`/`set`/`rm` against a named option list that starts empty. `auth ls` and
  `auth del` are refused outright: `ls` prints every key on the cluster, and a wrong delete cuts
  every VM disk on it (D3, lockout safety — never auto-delete). The entity operand is bounded to the
  `client.k8s-` prefix, so nothing this allowlist accepts can touch `client.admin`, a mon/osd/mgr
  keyring, or the PVE storage client.

  The minted key is captured in memory only, never Alchemy props, state, argv, or a log line.
  `auth get-or-create` mints it once, on the create path, and writes it straight to OpenBao
  (`<mount>/ceph/<entity>`). `auth get`'s stdout, which also carries the key, is read unfiltered on
  every reconcile to compare caps — the key is parsed out and dropped before anything is logged,
  returned or stored, so it never survives past that one read. Caps drift runs `auth caps` alone and
  never re-mints the key. After every write the transport re-checks
  `quorum_status` on a fresh connection and fails the row on a degraded answer, rather than
  continuing past it. `read` and `diff` never ssh — this family's plan is props-against-state only,
  and reconcile is where the only live check happens. Rows are creates through the first-create
  gate: a live entity found with no prior state is refused, not adopted, even under `--adopt`.

  Tested entirely offline against a fake dial — no ssh, no spawned process, ever, in this package's
  own test suite. `Ceph.AuthEntity` itself is not yet consumed by a stack; that lands with the
  Talos-on-PVE work this design gates.

- [#311](https://github.com/taslabs-net/homeflare-kit/pull/311) [`0047c69`](https://github.com/taslabs-net/homeflare-kit/commit/0047c693f0a7259f52492ca1e545adb9c3ae5bad) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Closes the three `Talos.*` follow-ups PR 307 named but did not fix
  (docs/plans/2026-09-26-talos-stack-first-boot.md), and exports their Resource constructors now
  that the fixes land:

  `Talos.Bootstrap` — "once means once". The shipped `isBootstrapped` turned every read failure into
  `false` (`Effect.orElseSucceed`), so `reconcile` could re-run `talosctl bootstrap` against an
  already-bootstrapped cluster after a merely transient read failure — Talos's only server-side guard
  is a non-empty etcd data directory, so this forms a second, isolated single-member cluster (split
  brain) rather than rejoining the existing one. Fixed: `read` now answers presence/absence correctly
  (`undefined` only from a successful read that finds no members; a failing read propagates instead of
  being read as absence); `diff` trusts `output.bootstrapped` once it is `true` and never touches the
  live cluster; `reconcile` checks `output?.bootstrapped` first and, once true, never spawns `talosctl
bootstrap` again — a failing or empty confirmation read both raise the new `TalosReBootstrapRefused`
  instead. Re-bootstrap is now a human decision, never an automatic one.

  `Talos.ClusterHealth` — no more swallowed transport errors. The shipped `read` caught EVERY error
  from its health check, including a `mintTalosconfig`/`bao` failure, into a plain `healthy: false` —
  a vault outage read exactly like "cluster not healthy yet". `read` and `reconcile` now only catch
  `TalosError` (a completed `talosctl health` run that itself exited non-zero); anything else
  propagates. The type's own doc comments also now say explicitly that a consuming stack's `after`
  must reach past `Talos.Bootstrap`/`Talos.Kubeconfig` through the Cilium CNI install — the default
  health checks (kube-proxy, CoreDNS) wait on a CNI that does not exist yet at bootstrap.

  `Talos.Kubeconfig` — lands in OpenBao instead of an un-vaulted host `runtimePath` that was never
  cleaned up. CREATE now runs `talosctl kubeconfig` into a throwaway unguessable temp path, reads it
  back, and writes its bytes into the vault via stdin (`credentials-write.ts`'s new `writeKvValue` —
  never argv), then deletes the temp file. Written ONCE at bring-up, not re-minted every deploy (a
  fresh admin cert every reconcile would rotate credentials for no reason): once `output` is defined,
  reconcile only reads the vault copy back to confirm it. The `runtimePath` prop is gone, replaced by
  an optional `kubeconfigKey` (default `'kubeconfig'`); the persisted `connection` no longer carries a
  host path — a consumer materializes its own temp file via the new `mintKubeconfig` (the same pattern
  `mintTalosconfig` already established for the talosconfig itself). Wiring `Kubernetes.ClusterAdapter`
  to call it is separate, later work.

  `TalosBootstrap`, `TalosClusterHealth` and `TalosKubeconfig` (plus their `*Attributes`/`*Props` types)
  now export from the package barrel alongside their `*Provider` factories, so a consuming stack can
  actually declare these rows — PR 307's red team held them back specifically for the defects above.

  Docs: `docs/plans/2026-09-26-talos-secrets-flow.md` records Tim's D1/D2/D3 answers (decision 61 —
  mini's vault + copy-list entry, agent plan lane denied, O-A all-in-vault-digest-pinned confirmed) and
  `docs/plans/2026-09-26-ceph-mon-transport.md` records decision 65's `auth get` amendment (read
  directly, in-process, on every reconcile — no node-side shell filter for that call — key dropped
  before anything is logged/returned/stored).

  **LAND red team fixes, applied before merge (same PR, never shipped broken):**

  - `Talos.Kubeconfig` could never actually be created — `read` returned a defined, empty-fingerprint
    object instead of `undefined` on a genuine cold start, so the engine always adopted it and forced
    `update`, and `reconcile`'s write-once gate then tried to confirm a key that had never been
    written. Fixed: `read` now distinguishes a measured OpenBao "key never written" response from
    every other failure; `reconcile`'s write-once branch also gates on a non-empty
    `credentialGeneration`, not just a defined `output`.
  - `credentials-write.ts`'s `writeKvValue` used `field=@-`, which is not the stdin convention (`@`
    means "read a file at this literal path") — measured against OpenBao v2.6.2, it fails outright, or
    silently reads a stray file literally named `-`. Fixed to `field=-`.
  - `Talos.ClusterHealth` could never pass with more than one control-plane node — `--nodes` took the
    full node list, and `talosctl health` refuses more than one. Fixed: one contact node for
    `--nodes`/`--endpoints`; the full lists still reach `--control-plane-nodes`/`--worker-nodes`.
  - The persisted `connection`'s `auth.path` was left `undefined`, which would let a consumer's stock
    `Kubernetes.KubeConfigAdapter` silently fall back to `$KUBECONFIG`/`~/.kube/config` instead of
    failing — exactly the exposure this feature removes elsewhere. Fixed to a sentinel path that can
    never resolve, so an early consumer fails loudly instead of reaching a stranger's cluster.
  - `Talos.Bootstrap` gained an optional `peers` prop: before a CREATE bootstraps a node, every listed
    peer must show a successful, empty etcd-members read, closing a split-brain path where a lost
    state row plus a reset node would otherwise re-bootstrap a second cluster.

- [#307](https://github.com/taslabs-net/homeflare-kit/pull/307) [`cf17df3`](https://github.com/taslabs-net/homeflare-kit/commit/cf17df313c12357de18fc937ede093708dd15963) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Talos machine config, talosconfig and any future KV-backed Talos material now come from OpenBao
  instead of repo disk — the accepted secrets-flow design
  (docs/plans/2026-09-26-talos-secrets-flow.md and -talos-stack-first-boot.md).

  Fixed the C1 temp-file-lifetime defect: `mintTalosconfig` used to wrap its own body in
  `Effect.scoped`, so its delete finalizer ran — deleting the file — the instant `mintTalosconfig`
  returned, before any caller ever passed the path to `talosctl`. It is now built on
  `Effect.acquireRelease` and contributes `Scope.Scope` to its own return type, so the file survives
  until the CALLER's own `Effect.scoped` closes; every Talos resource file (`kubeconfig.ts`,
  `talos-bootstrap.ts`, `talos-cluster-health.ts`, `talos-machine-config.ts`) now wraps its
  `read`/`reconcile` bodies accordingly. Also fixed `talosconfigKey`'s default, which read
  `<mount>/data/data/talosconfig` (now `<mount>/talosconfig`) — `bao kv get` inserts the KV-v2
  `data/` segment itself.

  `Talos.MachineConfig`'s props changed: `configFile` (a repo-relative path) and `insecure` are gone.
  Props now carry `configKey` (an OpenBao KV path under `target.mount`, e.g. `nodes/10001`) and a
  required `configDigest` — sha256 of the canonical config text, pinned in git by the operator after
  seeding the KV value. The digest is verified against the live KV content before ANY talosctl spawn;
  a mismatch fails closed with a typed `TalosConfigDigestMismatch`, applying nothing. `insecure` is no
  longer a prop: the CREATE path (`output === undefined`) applies `--insecure` and UPDATE never does,
  since a fixed value broke in both directions. No code path ever builds `--dry-run` (it prints the
  cluster CA key and bootstrap token on an otherwise-empty node).

  The live convergence check now hashes only the `spec` payload extracted from
  `talosctl get machineconfig v1alpha1 -o yaml`'s wrapper (`values.ts`'s new `extractMachineConfigSpec`)
  instead of the whole wrapper, which carries a version/timestamp that changes on every observation and
  could never match the pinned digest. The resource id is never omitted: an unfiltered `get
machineconfig` also lists a `persistent` resource sorted ahead of `v1alpha1`, so a bare `doc[0]` (the
  shipped shape) silently read the wrong one — `extractMachineConfigSpec` now also refuses more than one
  document rather than guessing. `MachineConfigAttributes.converged` is `'read-back' | 'accepted' |
false` instead of a boolean: `reconcile` proves convergence with a bounded, short-interval poll
  (`machine-config-poll.ts`) — `'read-back'` for `no-reboot` (the API never drops), `'accepted'` for
  `reboot`/`auto` (tolerates the API dropping for a reboot) — and raises a typed
  `TalosConvergenceTimeout` rather than a silent pass if the cap expires. `ApplyMode` drops `'staged'`
  and `'try'`: `try` reverts itself after its own timeout, so a poll "confirming" it would be watching a
  change already undone, and `staged` defers to a reboot this package never drives — both need design
  work this change does not do, not a policy guess.

  `read` now answers three ways instead of two (`machine-config-read.ts`), because Alchemy calls it with
  no prior state both as its cold-start adoption probe and to recover an interrupted create: an
  authenticated read that fails but an inserted `--insecure` maintenance-mode probe succeeds means "not
  created yet" (`undefined`); an authenticated read that succeeds and matches the pin is ours (plain
  attributes); one that succeeds and differs is `Unowned` — exists, not proven ours — so the engine
  fails closed behind `--adopt` instead of silently running `apply-config` onto a mistyped or foreign
  node; both reads failing propagates the authenticated error, never a disguised "not created". A
  transport failure was always meant to propagate rather than read as `converged: false` — this was the
  gap that broke it for the cold-start case specifically.

  `TalosMachineConfig` and its `*Provider` now export from the package barrel, so a consuming stack can
  declare `Talos.MachineConfig` rows — it fails closed on a digest mismatch and never adopts silently.
  `Talos.Bootstrap`, `Talos.ClusterHealth` and `Talos.Kubeconfig` stay provider-only: exporting their
  Resource constructors would let a stack declare them, and that is not safe yet — Bootstrap can plan a
  second `talosctl bootstrap` after a failing plan-time read (etcd split-brain risk), and Kubeconfig
  still writes a cluster-admin kubeconfig to un-vaulted host disk. `TalosTarget`/`TalosCredential`/
  `ApplyMode` export unconditionally since they carry no such risk.

  Not in this change, flagged rather than fixed: `Talos.Kubeconfig`'s host-disk kubeconfig (above);
  `Talos.Bootstrap`'s re-bootstrap risk and `Talos.ClusterHealth`'s CNI-ordering swallow-on-failure
  (docs/plans/2026-09-26-talos-stack-first-boot.md's "Bootstrap" and "CNI ordering" sections); no kit
  command yet prints only a KV value's digest, so an operator computes `sha256(canonicalText(content))`
  by hand to pin it.

- [#303](https://github.com/taslabs-net/homeflare-kit/pull/303) [`ca3f3bb`](https://github.com/taslabs-net/homeflare-kit/commit/ca3f3bbfe6659f1e265f2924dd33de8c124ac62c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Added three more read-only `Unifi.*` families, mirroring `Unifi.Network`/`Unifi.FirewallZone`'s existing shape: `Unifi.DnsPolicy`, `Unifi.AclRule`, and `Unifi.AclRuleOrdering` (one ordered, order-preserving resource per site — never `sortedSet` — for the site's ACL rule priority list, kept separate from `Unifi.AclRule` itself). Each is gated on a per-tag OpenAPI closure diff (10.4.57 vs a 10.6.97 mirror, diffing aid only) confirming its tag decodes the same on both versions; full breakdown in `docs/unifi-dns-policy.md` and `docs/unifi-acl-rule.md`. No write path exists for either family — `reconcile`/`delete` refuse via the existing typed `UnifiWriteRefused`, and the existing `GetOnlyHttpClient` wire guard and static write-op-reference test cover them without any change to either mechanism.

- [#309](https://github.com/taslabs-net/homeflare-kit/pull/309) [`1b24ce7`](https://github.com/taslabs-net/homeflare-kit/commit/1b24ce7d92dc0c3a92ad83f1cf43a44c70e2b59c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Added three more read-only `Unifi.*` families: `Unifi.FirewallPolicy`, `Unifi.FirewallPolicyOrdering`, and `Unifi.TrafficMatchingList`. `Unifi.FirewallPolicyOrdering` is keyed per `(sourceFirewallZoneId, destinationFirewallZoneId)` zone pair — one resource per pair, not site-wide like `Unifi.AclRuleOrdering` — comparing its `before`/`afterSystemDefined` policy-id lists independently and order-preservingly (T5; never `sortedSet`, since a policy moving between the two halves is real drift on both fields, not one reorder). `Unifi.FirewallPolicy` compares its post-A3-typed `action`/`source`/`destination`/`ipProtocolScope`/`schedule` fields wholesale, normalizing only the one genuinely top-level set-shaped array (`connectionStateFilter`); its own decode-proof test walks B0b's `pageAll` against this family's page shape (T9's 424-live-policy scale) even though `fetchLive` itself reads by id, same as `Unifi.AclRule`. `Unifi.TrafficMatchingList` is the simplest object shape in the directory (no `metadata` at all) and keeps its post-A3-typed `items` union compared wholesale, same known-gap posture ACL rule's own nested filters already carry (a membership-preserving reorder of object-shaped match entries has no cheap canonical sort key).

  Each family is gated on its own per-tag OpenAPI closure diff (10.4.57 vs the same `beezly/unifi-apis` 10.6.97 mirror every other family doc cites, diffing aid only): `Firewall`'s 13 operations (106-schema closure) and `Traffic Matching Lists`' 5 operations (19-schema closure) are both byte-identical between versions and share zero schemas with the 14 that changed elsewhere in the document — corroborated independently by the A3 changeset's own broader 25-operation/139-schema re-check. Full breakdown in `docs/unifi-firewall-policy.md` and `docs/unifi-traffic-matching-list.md`; `docs/unifi.md`'s own family index and its now-outdated "FirewallPolicy is a bigger, separate PR" note are updated to point at them.

  No write path exists for any of the three — `reconcile`/`delete` refuse via the existing typed `UnifiWriteRefused`, and the existing `GetOnlyHttpClient` wire guard and static write-op-reference test cover them without any change to either mechanism.

- [#308](https://github.com/taslabs-net/homeflare-kit/pull/308) [`9e2ccd9`](https://github.com/taslabs-net/homeflare-kit/commit/9e2ccd9a88c1d57fecb7d94c9a4929d1f9017d2c) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Added a fifth read-only `Unifi.*` family, `Unifi.WifiBroadcast` (one WiFi network/SSID broadcast on a site). Unlike every other family here, its declarable shape is built entirely from the LIST endpoint's overview response (`getWifiBroadcastPage`) — the single-object details call (`getWifiBroadcastDetails`) is never called, because that shape carries the WPA/PPSK passphrase (T23; the spec has no `writeOnly` flag on it), and a static guard now bans any source reference to that call under `src/unifi`. `WifiBroadcastProps`/`WifiBroadcastAttributes` type `securityConfiguration` as the overview's own `{type, presharedKeyNetworkIds}` shape, so no passphrase field is DECLARED for them to carry; because the SDK's wire decode does not strip a key a schema doesn't declare, every nested object this family touches (`network`, `hotspotConfiguration`, `broadcastingDeviceFilter`, and each `presharedKeyNetworkIds` element) is rebuilt field-by-field at runtime too, not just typed narrowly — `wifi-broadcast-secrets.test.ts` proves a stray passphrase-shaped key on the wire never survives into attributes, the declaration renderer, or a forced decode-failure error, for all five of those locations. With no get-by-id call for the overview shape, `fetchLive` is also the first resource-level consumer of the existing `pageAll` pager, whose own error messages now render a non-numeric wire value as a fixed placeholder rather than interpolating it directly. No write path exists — `reconcile`/`delete` refuse via the existing typed `UnifiWriteRefused`, and the existing `GetOnlyHttpClient` wire guard and static write-op-reference test cover it without any change to either mechanism.

### Patch Changes

- [#310](https://github.com/taslabs-net/homeflare-kit/pull/310) [`77edfec`](https://github.com/taslabs-net/homeflare-kit/commit/77edfec37d0f48c98c0d9d8e047b690db6388ee5) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fixed `Proxmox.Vm`'s disk-drift check (`qemu-volume.ts`'s `judgeDisk`): it never recognized
  `<storage>:0,import-from=<volid>` (PVE's create-time spelling for importing a disk from another
  volume or a downloaded image) as a new-disk spelling, so it compared the declared literal volname
  `"0"` against PVE's live read-back of the real `vm-<vmid>-disk-<n>` it allocated on import and
  refused the update -- on the very deploy that created the disk (post-write verification reads the
  config right back) and on every plan after, since the declared value stays `import-from=...` for
  as long as the caller keeps declaring it that way.

  Found by homeflare-proxmox PR 84's red team against a real fake-PVE engine; tracked there as the
  `kit-disk-import-bug` blocker on `declareTalos`. `<storage>:0,import-from=<volid>` is now treated
  the same as the existing `<storage>:GiB` and `<storage>:cloudinit` new-disk spellings: it always
  matches whatever volume is already live in that slot, and no resize is ever attempted for it.

  Also fixes a LAND-stage red-team finding on this same change: options declared alongside
  `import-from` (e.g. `<storage>:0,import-from=<volid>,iothread=1`) are now recognized and enforced
  regardless of where they sit relative to `import-from`, instead of being silently dropped (declared
  after it) or stranding the disk with a forever-refused volname mismatch (declared before it).

## 0.39.0

### Minor Changes

- [#302](https://github.com/taslabs-net/homeflare-kit/pull/302) [`3f8a8af`](https://github.com/taslabs-net/homeflare-kit/commit/3f8a8af9df4dcdb0dd54be0f50f15d62e815b434) Thanks [@taslabs-net](https://github.com/taslabs-net)! - New `@homeflare/alchemy/telemetry`: `telemetryLayer`, an OTLP tracing/logging/metrics `Layer` a
  stack merges into its own `providers` — off unless given explicit `{ traces?, logs?, metrics? }`
  endpoints, no default collector anywhere in it. This is not alchemy's own CLI-wide telemetry
  (`otel.alchemy.run`, hard-coded, opted out via `~/.alchemy/telemetry-disabled`): it is a per-stack
  layer a consumer opts into with its own endpoints (the estate's Victoria stack, in homeflare-mini's
  case — this package names no estate host).

  Every span — a provider's own, effect's `HttpClient` client spans, and alchemy's own plan/apply
  engine spans — is redacted before export in two passes: `Tracer.Tracer` itself drops every HTTP
  header outright, strips every query string and blanks a consumer-supplied denylist of host/path
  segments (e.g. a UniFi console id) to `<redacted>`; a second pass at `OtlpSerialization` catches what
  that first pass cannot reach — a failed span's `exception.message`/`status.message` (built from the
  exit's `Cause` at export time) and a log line turned into a span event — by matching the denylist as
  a substring in that free text, and covers logs the same way. Bodies are protobuf-encoded, not
  JSON — VictoriaLogs/Metrics both reject the OTLP JSON encoding, silently, so the wire format is not
  a style choice. The transport is sealed — merging this layer into a stack's `providers` alongside a
  fetch-based provider (Caddy, LiteLLM, Forgejo) never lets its own `FetchHttpClient` leak into that
  provider's requirements, the same leak PR 293 fixed for Caddy's admin transport.

  See [docs/telemetry.md](../packages/alchemy/docs/telemetry.md) for how a consumer stack wires real
  endpoints in, and [docs/telemetry-spike.md](../packages/alchemy/docs/telemetry-spike.md) for what an
  offline spike against alchemy 2.0.0-beta.79's own engine measured actually arriving at a collector.

- [#296](https://github.com/taslabs-net/homeflare-kit/pull/296) [`4bdcc4f`](https://github.com/taslabs-net/homeflare-kit/commit/4bdcc4fc2340bea9696156b7b4ff4ef19eadfeff) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Forgejo.TeamMember` now declares `defaultRemovalPolicy: 'retain'`, matching `Forgejo.Repository`
  and `Forgejo.OrgLabel`. Previously the family had no default, so alchemy's own engine fallback
  (`destroy`) applied: dropping a `TeamMember` declaration from a stack — a feature gate toggled off,
  a resource id renamed — called `organization.orgRemoveTeamMember` and revoked a real membership on
  live Forgejo, with no way to tell from the declaration alone that this would happen. Found in
  `homeflare-mini` PR 82's red team (970e8be), which had to pipe every `ForgejoTeamMember(...)` call
  through `.pipe(RemovalPolicy.retain())` by hand to avoid dropping `forgejo-provision` from `Owners`.

  A stack that means to remove a real membership still can, with `.pipe(RemovalPolicy.destroy())` —
  `destroy` was, and stays, fully implemented. A stack already piping `RemovalPolicy.retain()` by hand
  (homeflare-mini) is unaffected; the pipe is now redundant, not wrong. Bumped as `minor`, not `patch`:
  this changes what removing a declaration does, not just an internal detail.

  ⚠️ **The new default does not protect an existing row until you deploy once first.** Alchemy plans
  a removal from the policy saved on that resource's state row, not from this default — the default
  only reaches an already-existing row's state on a deploy where the resource is otherwise a no-op
  (alchemy rewrites the row and logs `removal policy destroy → retain`). Concretely:

  - **To adopt retain for a `TeamMember` declared before this bump:** deploy the version bump first,
    with the declaration left in place (a no-op plan updates the saved policy). Only remove the
    declaration in a later deploy.
  - **Dropping the bump and the declaration in the SAME deploy still deletes the live membership** —
    the plan reads the row's old `destroy` policy, not this new default.
  - **To revoke a membership on purpose**, the sequence is unchanged: deploy with
    `.pipe(RemovalPolicy.destroy())` first, then remove the declaration in a later deploy.

- [#297](https://github.com/taslabs-net/homeflare-kit/pull/297) [`a821575`](https://github.com/taslabs-net/homeflare-kit/commit/a82157562aeea6fe06a2dd9382e131451411691e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Export `Proxmox.Vm` (`ProxmoxVm`) from the public barrel for Talos VMs: cpu/cores/sockets/memory,
  scsi disks on any storage (including `cephtb4`), `net0`/indexed NICs as a VLAN-aware bridge+tag,
  the cloud-init drive and `ipconfig0`, boot order, the guest agent and a serial console. Every field
  is managed only when declared (`qemu-props.ts`'s declared-keys model) — the fix for the
  "5-default PUT", where an update used to resend `cores`/`memory`/`name`/`onboot`/`sockets` with a
  hard default for whichever field the declaration left out, silently resetting it on an adopted VM.
  `cipassword` and `machine` can never be props (typed `never`, and refused at runtime if smuggled
  past the types). `ProxmoxVm` defaults to `RemovalPolicy.retain()`. Node-pinned semantics are
  unchanged: a VM found on another node still fails the plan ("A migration is not an update").

  Add `Proxmox.StorageDownload` (`ProxmoxStorageDownload`): a checksum-pinned `download-url` fetch
  onto a storage's `import` content, for staging a Talos boot image before a `Proxmox.Vm` references
  it as a disk source. `checksum`/`checksumAlgorithm` are required props (narrower than the vendor's
  own optional pair) and refused at runtime if left blank. There is no update path — PVE does not
  remember the `url`/`checksum` a volume was created from, so `filename` (with `storage`) is the
  identity: changing it plans a `replace` (the old file is deleted, the new one downloaded under its
  own name); a changed `checksum`/`url`/etc on the SAME `filename` is refused at plan time rather than
  silently accepted, since there is nothing left to verify it against. A failed download task (a
  checksum mismatch included) refuses the plan rather than reporting success. Delete is idempotent
  (a volume already gone is success) and not retained by default, since the file is reproducible from
  its own declaration.

  Both families are wired into the vendor constraint tables (`download-url`'s own
  `generated/constraints/pve-nodes-storage.ts`) and the ownership ledger, so a value the vendor would
  reject is refused at plan time. A live VM or file this stack holds no state for is never adopted or
  written without `--adopt` / `adopt(true)` (`ownership/probe.ts`'s `ownedRead`, `ownership/adopt.ts`'s
  `refuseTakeover`) — for `Proxmox.StorageDownload` this also guards its delete, since the family is
  not retained by default. A changed `vmid` on an already-managed `Proxmox.Vm` is refused as a
  different machine rather than planned as an update. Disk (`scsiN`/`ideN`) and NIC (`netN`) drift is
  now judged per key against the live volume id and live MAC (`qemu-volume.ts`/`qemu-net.ts`), so a
  declared "new disk" or MAC-less NIC no longer re-drifts (and gets rewritten) on every deploy after
  PVE allocates the real volume or generates the real MAC. Fixed a codegen gap surfaced by
  `download-url`'s `compression` parameter: an explicit vendor `"enum": null` (as opposed to an absent
  `enum`) was copied verbatim into the emitted table instead of being treated as no constraint.

### Patch Changes

- [#301](https://github.com/taslabs-net/homeflare-kit/pull/301) [`413f62b`](https://github.com/taslabs-net/homeflare-kit/commit/413f62b01ddb7e3fafb1f39f4b0153aa9ddadf5b) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Unifi.*` providers now refuse any non-`GET` request at the wire (`GetOnlyHttpClient`, installed in `unifiHandlers`), defense in depth alongside the existing per-operation write refusal, backed by a static test that bans any create/update/delete/patch/execute/remove/adopt SDK reference under `src/unifi`. Added `src/unifi/paginate.ts`'s consumer-side offset pager for the SDK's un-paginated list operations, and a pure `driftOf(live, props)` per family (`Unifi.Network`, `Unifi.FirewallZone`) reporting field-level drift for a future pre-import check.

## 0.38.0

### Minor Changes

- [#293](https://github.com/taslabs-net/homeflare-kit/pull/293) [`f11e6a6`](https://github.com/taslabs-net/homeflare-kit/commit/f11e6a6cae2ee4ca0a4604f4f23ecf1924351958) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `caddyProviders()` no longer merges Caddy's admin `HttpClient.HttpClient` (and `Credentials`) into
  the stack's own ambient context. Previously `caddyAdminLayer` `provideMerge`d Caddy's admin transport
  straight into `caddyProviders()`'s own Layer output; any other fetch-based provider merged into the
  same stack — `Layer.mergeAll(…, caddyProviders(), …, forgejoProviders())`, for example — could then
  resolve Caddy's admin `HttpClient.HttpClient` instead of the stack's real ambient one for its own
  `read`/`diff`/`reconcile` calls, misrouting its requests to Caddy's admin API. Affected: any stack
  that loads `caddyProviders()` alongside another fetch-based provider (homeflare-mini's `Forgejo.*`
  and `LiteLLM.PassThroughEndpoint` rows measured reading against Caddy's admin API instead of their
  own targets — verify's `read` came back absent/failed; writes were not exercised, so they are
  inferred from the same misrouted client, not separately measured).

  The admin transport's `Credentials`/`HttpClient.HttpClient` are now carried under a new house-only
  `CaddyAdminTransport` tag (never a generic platform service), and `CaddyConfigProvider()` provides
  them locally, scoped to exactly the effects that call `@distilled.cloud/caddy`'s operations. Caddy's
  own behaviour (unix socket and TCP admin, retries, timeouts, the admin guard) is unchanged.

  Public API narrowed: `caddyAdminLayer` now returns `Layer<CaddyAdminService | CaddyAdminTransport>`
  (previously it also carried `Credentials | HttpClient.HttpClient`), and `CaddyConfigProvider()` now
  requires `CaddyAdminTransport` instead of those SDK services directly. `caddyProviders()` and
  `localCaddyAdmin()` are unaffected; only code that wired `caddyAdminLayer`'s output by hand, or ran
  `@distilled.cloud/caddy` operations directly against it outside `caddyProviders()`, would need to
  change — no tray repo does this today. Bumped minor rather than patch because the package is 0.x and
  this narrows a public contract.

## 0.37.8

### Patch Changes

- [#290](https://github.com/taslabs-net/homeflare-kit/pull/290) [`6ddbff3`](https://github.com/taslabs-net/homeflare-kit/commit/6ddbff38096feecb36d3f0efe6efc0418e938145) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `Podman.Container` no longer reads as an existing (and therefore "adopted") resource when its
  `.container` file is absent but a PLAIN unit that genuinely outranks Quadlet's generator in
  systemd's unit load path — `/etc/systemd/system` chief among them, never a vendor directory like
  `/usr/lib/systemd/system`, which is lower precedence than the generator and not a real shadow —
  already answers to the same service name. The read now refuses at plan time, naming the shadowing
  unit file and the fix (move it aside before declaring the container), instead of a create silently
  becoming an "adopted" plan whose eventual apply would leave the pre-existing plain unit running
  untouched while state recorded attributes read back from it. `verifyGenerated` is also hardened to
  check the same fact as a backstop at apply time, for the case this plan-time check does not cover.

- [#292](https://github.com/taslabs-net/homeflare-kit/pull/292) [`4225c4c`](https://github.com/taslabs-net/homeflare-kit/commit/4225c4c95dbf3e7e763c83565481487ef1a88212) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `sshSudoRunner` now lets `Podman.Container` reach its own Quadlet-generated unit: a generated
  unit's `FragmentPath` sits under a systemd generator's own output directory (`/run/systemd/generator`,
  never a declared prefix), but its `SourcePath` names the `.container` file that produced it — when
  that `SourcePath` is under a declared prefix, the runner elevates. Previously every generated unit
  was refused outright, so `Podman.Container` could never be restarted through this runner at all.

  `Systemd.Unit`'s validation now accepts leading blank lines and `#`/`;` comments before the first
  `[Section]`, per `systemd.syntax(7)` — a unit file systemd already loads could still fail
  `assertValid` if its first lines were comments. A genuine `key=value` line with no section still
  refuses.

  `Podman.Container`'s "the container's unit is NOT running" refusal message no longer asserts a
  running state it does not actually know (measured false for a refusal that ran before sudo did
  anything at all); it reads the unit's live state back and reports that instead.

## 0.37.7

### Patch Changes

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move Lxc reads, writes and task polling to named distilled operations. Preserve task
  credentials, ownership, digests, no-shrink checks and retention; prove absence with
  the exact SDK missing-config tag and the same credential's cluster-wide vmid check.

- [#283](https://github.com/taslabs-net/homeflare-kit/pull/283) [`a19c663`](https://github.com/taslabs-net/homeflare-kit/commit/a19c6632e3654c73fb3bf03dd9e2869b9ed65fdd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Keep the PVE network `changes` sibling through the distilled protocol, and move NetworkApply onto named operations without storing the diff.

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move ReplicationJob and FirewallAlias lifecycle transport to named distilled SDK operations. Preserve no-write adoption, existing form and deletion semantics, and fail closed on unrelated errors or malformed reads.

- [#278](https://github.com/taslabs-net/homeflare-kit/pull/278) [`4b3c9eb`](https://github.com/taslabs-net/homeflare-kit/commit/4b3c9ebc0792386e797b2e1293b3c41cce4ddac7) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix two regressions from the distilled transport migration: ReplicationJob reads no
  longer fail closed when a SectionConfig release echoes guest/jobnum as text instead
  of a JSON number, and lxcTask's poll loop no longer aborts a still-running task on a
  status word other than exactly "running"/"stopped".

- [#282](https://github.com/taslabs-net/homeflare-kit/pull/282) [`08b1789`](https://github.com/taslabs-net/homeflare-kit/commit/08b1789cf835af177960aba5e4fbf16d007b087e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Move Proxmox.Vm onto named QEMU operations. Guest deletion uses the destroy route, and only the vendor missing-config error is absence.

- [#282](https://github.com/taslabs-net/homeflare-kit/pull/282) [`08b1789`](https://github.com/taslabs-net/homeflare-kit/commit/08b1789cf835af177960aba5e4fbf16d007b087e) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Fix a regression in the QEMU distilled transport migration: qemuTask's poll loop no
  longer aborts a still-running VM create/destroy on a status word other than exactly
  "running"/"stopped" (the same class of fix already shipped for lxcTask).

## 0.37.6

### Patch Changes

- [#276](https://github.com/taslabs-net/homeflare-kit/pull/276) [`0d9175d`](https://github.com/taslabs-net/homeflare-kit/commit/0d9175d89f5b05eea64da731affb4a5edc9b4e25) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Use the distilled OpenBao SDK for AppRole metadata reads, writes, deletes and rename
  collision checks. Preserve omitted role settings and existing no-op, ownership and deletion
  guards; permission and malformed-response failures never become absence. Reads and the
  metadata write retain the existing bounded transport retry — the write sends every managed
  field every time, so replaying it after a transport failure converges on the same role;
  delete makes one attempt. Checked against the OpenBao 2.6.2 generated AppRole schema and
  pinned vendor source. No login or credential issuance operations change.

- [#276](https://github.com/taslabs-net/homeflare-kit/pull/276) [`0d9175d`](https://github.com/taslabs-net/homeflare-kit/commit/0d9175d89f5b05eea64da731affb4a5edc9b4e25) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Run every OpenBao ACL policy lifecycle call, including rename collision reads, through
  the distilled OpenBao SDK. Preserve shared concurrency limits, agent sockets, runtime
  credentials, namespace selection, and token trace redaction. Only typed missing-policy
  errors mean absence; refused and malformed reads fail. Reads retain bounded transport
  retries; a policy write sends the full policy text every time, so it retries a transport
  failure the same bounded way; a delete makes one attempt after an uncertain response.
  Checked against the OpenBao 2.6.2 generated schema and pinned vendor policy handlers.

## 0.37.5

### Patch Changes

- [#285](https://github.com/taslabs-net/homeflare-kit/pull/285) [`e62f8e9`](https://github.com/taslabs-net/homeflare-kit/commit/e62f8e975b3c9a110a7e94c9c02644539e459600) Thanks [@taslabs-net](https://github.com/taslabs-net)! - LiteLLM pass-through calls use the fetch HTTP client, so a stack that also provides Caddy's admin client still reaches the proxy. Host.Directory recovers an interrupted create whose path was still an Output instead of crashing the next plan.

## 0.37.4

### Patch Changes

- [#280](https://github.com/taslabs-net/homeflare-kit/pull/280) [`2c8556e`](https://github.com/taslabs-net/homeflare-kit/commit/2c8556e7625d2596f41f238f2018c65df555bbc9) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Host.Directory on macOS no longer passes `--` to chmod and chown. Those BSD tools treat that token as a filename, so a first deploy created the directory and then failed the resource. Linux still passes `--`, which the sudo allowlist requires. mkdir and rmdir are unchanged.

  The archive inflater's source stream is typed as the chunk type DecompressionStream accepts, so the package typechecks under TypeScript 7. The bytes are unchanged.

- [#281](https://github.com/taslabs-net/homeflare-kit/pull/281) [`b0c9fc9`](https://github.com/taslabs-net/homeflare-kit/commit/b0c9fc9580463cff30c94efebe498b8cef7c9ddd) Thanks [@taslabs-net](https://github.com/taslabs-net)! - `LiteLLM.PassThroughEndpoint` can be yielded from an Alchemy stack body. The proxy credentials stay on the provider layer, and that layer keeps them available when the engine calls the handlers.

## 0.37.3

### Patch Changes

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Run PBS notification matchers and sendmail, SMTP and webhook targets through the distilled
  Proxmox Backup Server SDK. Read failures now preserve their typed errors instead of planning
  false creates; only typed NotFound means absence or an already completed delete. Keep leased
  credentials, bounded requests, secret seals and no-op adoption. Vendor schema: PBS 4.2.6-1,
  SDK 0.3.1.

  Preflight replacement destinations, required write-only values and vendor/SDK input constraints
  before deleting a working target. Typed destination read failures stop replacement; existing
  renamed targets remain adoptable without requiring secret values the plan cannot observe.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Run PBS datastore, prune, sync and verification providers through the distilled PBS SDK,
  using the proxmox-backup-server 4.2.6-1 schema. Preserve existing retention, parked-job,
  create-only and state semantics while allowing only typed missing-section errors to mean
  absence. Permission, transport and malformed-response failures now stop planning instead
  of suggesting a create or confirming a deletion.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Use direct distilled SDK operations for PVE Pool, BackupJob and MetricServer lifecycle calls,
  walked against pve-manager 9.2.11. Only typed missing-object errors permit creation or idempotent
  deletion; authentication, permission and unrelated server failures propagate. Preserve existing
  adoption no-ops, retention normalization, omitted backup settings and metric-server secret fields.

- [#274](https://github.com/taslabs-net/homeflare-kit/pull/274) [`a740b7f`](https://github.com/taslabs-net/homeflare-kit/commit/a740b7fc64cf4f7ca7e60445fa9f2393b4aee664) - Move PVE notification targets and matchers onto generated distilled SDK operations.
  Failed reads now stop the plan; only typed NotFound means absence. Keep matching
  adoption write-free, preserve list items and explicit clearing, and validate read
  payloads without exposing server values. Identity changes replace the old resource;
  a same-name endpoint type change deletes first because names are shared across types.
  Preflight the destination and its vendor/SDK input constraints before replacement can
  delete a working target. Typed destination read failures stop replacement, while existing
  renamed targets remain adoptable without create-only secrets.

  Vendor schema: pve-manager 9.2.11. Read-only probes confirmed missing notification
  GETs return 404; write behavior is exercised through the real SDK and Alchemy engine
  against isolated fixtures, with no live notification changes.

## 0.37.2

### Patch Changes

- [#270](https://github.com/taslabs-net/homeflare-kit/pull/270) [`7710691`](https://github.com/taslabs-net/homeflare-kit/commit/77106917f0781d53bfedde224f71e7a7ad9b62bc) - Complete the CephFS transport migration to distilled Proxmox 0.3.0 (vendor schema
  pve-manager 9.2.11): send destructive DELETE flags through its corrected query binding
  and fold only the typed CephFsNotFound error. Preserve bounded task polling, safe
  omitted-flag defaults and the final live index read that proves deletion.

## 0.37.1

### Patch Changes

- [#268](https://github.com/taslabs-net/homeflare-kit/pull/268) [`7c9e674`](https://github.com/taslabs-net/homeflare-kit/commit/7c9e674545829191a560730924e557d5ccbb2bd2) Thanks [@taslabs-net](https://github.com/taslabs-net)! - Use the distilled Proxmox SDK's typed missing-user, group, storage and Ceph-pool errors
  for absence. Propagate other cold-read/reconcile failures, and propagate failed Ceph
  filesystem and daemon index reads instead of treating them as missing resources.

  This prevents speculative creates after failed reads and prevents a CephFS delete
  from claiming success when its preflight or read-back cannot observe the filesystem.
  Existing confirmed-row User/Group/Storage checks and credential-denial reporting remain.
  Real-protocol fixtures cover expected absence and unrelated 401/403/500 errors; engine
  tests prove a failed cold read sends no create and a failed delete read is not success.

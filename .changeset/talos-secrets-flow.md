---
'@homeflare/alchemy': minor
---

Talos machine config, talosconfig and any future KV-backed Talos material now come from OpenBao
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

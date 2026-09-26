---
'@homeflare/alchemy': minor
---

Talos machine config, talosconfig and any future KV-backed Talos material now come from OpenBao
instead of repo disk — the accepted secrets-flow design (docs/plans/2026-09-26-talos-secrets-flow.md

- -talos-stack-first-boot.md).

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
`talosctl get machineconfig -o yaml`'s wrapper (`values.ts`'s new `extractMachineConfigSpec`) instead
of the whole wrapper, which carries a version/timestamp that changes on every observation and could
never match the pinned digest. `MachineConfigAttributes.converged` is now `'read-back' | 'accepted' |
false` instead of a boolean: `reconcile` proves convergence with a bounded, short-interval poll
(`machine-config-poll.ts`) — `'read-back'` for `no-reboot`/`try` (the API never drops), `'accepted'`
for `reboot`/`staged`/`auto` (tolerates the API dropping for a reboot) — and raises a typed
`TalosConvergenceTimeout` rather than a silent pass if the cap expires; `read` returns `false` only
when a live read genuinely succeeds and differs, never as a stand-in for a failed read, which now
propagates as its own error instead of being swallowed.

`TalosMachineConfig`, `TalosBootstrap`, `TalosClusterHealth`, `TalosKubeconfig` (the Resource
constructors, not just their `*Provider`s) and `TalosTarget`/`TalosCredential`/`ApplyMode` now
export from the package barrel, so a consuming stack can actually declare these rows.

Not in this change: `Talos.Kubeconfig` still writes the admin kubeconfig to a host `runtimePath`
that is never cleaned up, rather than landing it in the vault the way the design's "Measured today"
section describes for K-A3's full scope — flagged, not fixed, here.

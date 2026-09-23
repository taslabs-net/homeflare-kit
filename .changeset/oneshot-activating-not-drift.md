---
'@homeflare/alchemy': patch
---

Fix `Systemd.Unit`: for a unit declared `started: false`, `ActiveState=activating` no longer
reads as drift. A timer-driven `Type=oneshot` service (no `[Install]`; its `.timer` starts it)
reports `activating` for the whole duration of its run, not an instant — so a plan taken
mid-run used to show `update`, and a deploy would `systemctl stop` a check that was already
running. Now only `ActiveState=active` counts as drift for `started: false`; `started: true`
(the default) is unchanged. `activating` with `SubState=auto-restart`/`auto-restart-queued` —
systemd's crash-restart backoff, not a fresh start — is excluded from that exemption and still
counts as drift, so a crash-looping unit declared `started: false` is still stopped. Both
`diffUnit` (unit-lifecycle.ts) and `settle` (unit-settle.ts) now share one predicate,
`isUnitRunning` (unit-form.ts), so they can never disagree about it.

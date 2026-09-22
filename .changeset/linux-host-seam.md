---
'@homeflare/alchemy': minor
---

Linux hosts on the existing HostRunner seam: `@homeflare/alchemy/linux`.

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

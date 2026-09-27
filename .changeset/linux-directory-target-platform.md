---
'@homeflare/alchemy': patch
---

Host.Directory's chmod/chown no longer decide whether to pass `--` by the OS of the machine running Alchemy. They now read the target's own platform from `HostRunner.platform` — a new field every `HostRunner` declares (`localRunner()`, `sshRunner()`, `sshSudoRunner()`, and any consumer's own runner).

Deploying from a Mac to a Linux host over `sshSudoRunner` (homeflare-ct100, 2026-09-27) dropped GNU's required `--` because the old check read `process.platform`, the Mac's own OS, and the sudo allowlist refused every chown with `SudoRefusedError` even though the path was under a declared prefix. `localRunner()`'s own local deploys never showed this, because there the target and the calling process are the same machine.

A custom `HostRunner` implementation now needs to declare `platform: 'darwin' | 'linux'`.

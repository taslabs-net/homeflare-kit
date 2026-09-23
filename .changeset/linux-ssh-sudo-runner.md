---
'@homeflare/alchemy': minor
---

Add `sshSudoRunner()` to `@homeflare/alchemy/linux` — the Linux twin of the launchd subpath's
`sudoRunner()`, for a host stack whose ssh user is not root but has passwordless sudo
(`(ALL) NOPASSWD: ALL`). The deploy runs as the operator, and only a fixed allowlist of absolute
`sudo -n` calls elevates: `install`→`mv` (GNU `install` writes through its destination, so this
runner stages, installs into a derived temp file, then `mv`s it into place — a rename(2), atomic
by construction), `rm`, `mkdir`/`chmod`/`chown`/`rmdir` for `Host.Directory`, and
`daemon-reload`/`enable`/`disable`/`start`/`stop`/`restart` for `Systemd.Unit` and
`Systemd.Timer` (gated by each unit's own `FragmentPath`, so a vendor unit like
`pveproxy.service` stays unreachable). Every privileged argv is logged before it runs; a plan
never elevates (`checkWrite` and every read stay on the operator); the host guard reads the whole
directory chain from `/` down to the target in one `ls -ldn` call, refusing anything not
root-owned, group/other-writable, ACL-flagged, or the wrong kind. See
`packages/alchemy/docs/linux-sudo.md` for the full argv table and what is measured versus
reasoned — write paths are reasoned, not run live; construction and `checkWrite` were exercised
read-only against a real Debian 13 / trixie host (systemd 257.13-1~deb13u1, coreutils 9.7-3),
confirming nothing is elevated by a plan.

homeflare-proxmox's first consumer: a script, systemd service and timer declared per Proxmox
node with `sshSudoRunner({ host, prefixes: ['/usr/local/bin', '/etc/systemd/system'] })`.
Groundwork from PR 132 (`src/linux/sudo-listing.ts`, the `ls -ldn` chain reader) is now used
directly by the new guard rather than left unreferenced.

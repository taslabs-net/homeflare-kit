# Linux host shapes — the measurements

Status: active
Verified: 2026-09-22

The evidence behind [linux-host.md](./linux-host.md). Debian 13, systemd 257
(257.13-1~deb13u1), kernel 7.0.14-pve, `LANG=C`, over ssh as an unprivileged
user. ⛔ **Read-only: nothing was enabled, started, reloaded or written.**

## systemd and coreutils, as observed

- ⛔ `systemctl show -p … <unknown>` **exits 0** and answers
  `LoadState=not-found`. The exit code is not the answer; `LoadState` is.
- Properties come back in systemd's order, not the order asked for.
- `is-enabled`/`is-active` of an unknown unit exit **4** with `not-found` /
  `inactive` — answers, not errors.
- `/etc/systemd/system` is `root:root 0755`.
- `systemd-analyze unit-paths`, minus per-user and generator directories:
  `/etc/systemd/system`, `/run/systemd/system`, `/usr/local/lib/systemd/system`,
  `/usr/lib/systemd/system`. `/lib/systemd/system` is the same directory before
  the /usr merge, which the measured host does not have separately.
- `stat -c '%f %a %u %g %s' /etc/hostname` → `81a4 644 0 0 4`; a missing path
  exits 1. GNU `stat` does not follow symlinks without `-L`, which is what makes
  it the lstat the seam requires.

⚠️ The write subcommands were **never run** for this document: `daemon-reload`,
`enable`, `disable`, `start`, `stop` and `restart` are reasoned, checked for
exit 0, and their effect read back with `show` rather than assumed.

## The runner itself, exercised end to end

★ Read-only against the same host, with the runner from `src/linux/`:

- `stat` of a file, of a missing path, and of a **symlink** — reported
  `symlink`, so the lstat contract holds over the wire and a write can refuse it.
- `readFile` of a present path (bytes round-tripped) and of an absent one
  (`undefined`, not an error).
- `getent` user and group lookups through the shared `host-lookup` parsers.
- A failing `exec` (exit 1, not a thrown transport error).
- An argument containing a space, a `$`, a backtick and a `;` arriving
  **verbatim** on the far side — the quoting proven rather than argued.
- `systemctl show` of a known and an unknown unit, and `readUnit` of the unknown
  one answering `undefined`.

🔴 **That run is what found the framing bug.** The remote scripts end a branch
with `exit <code>` to mean "nothing was there"; at the top level that exit leaves
the shell before the status marker prints, so `stat` of a missing path came back
as _"the remote command did not report a status (ssh exit 66)"_ — a transport
failure, correctly, for a script that never finished. The frame now runs the
script inside `( … )`, and a test drives the real frame through a real `/bin/sh`.

⚠️ **What is still unverified.** Every write path: `daemon-reload`, `enable`,
`disable`, `start`, `stop`, `restart`, the atomic file write and `mkdir` /
`chmod` / `chown` / `rmdir`. Running them would have changed a live host. They
are reasoned, checked for exit 0, and their effect read back with a read command
— never assumed.

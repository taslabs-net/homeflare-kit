# Deploying a Linux host as an unprivileged ssh user — `sshSudoRunner()`

The Linux twin of [`sudoRunner()`](./launchd-sudo.md): the deploy runs as the ssh
user, and only a fixed allowlist of calls goes through `sudo -n`, in exact argv
shapes, logging each one. It is an explicit opt-in — `sshRunner()` stays the
default and never elevates (docs/linux-host.md).

```ts
import { linuxProviders, sshSudoRunner } from '@homeflare/alchemy/linux';

const runner = await sshSudoRunner({
  host: 'n2',
  // ⛔ Required: the directories root may write. Each — every directory above
  //   it, and every directory below it on the way to a file — must be one
  //   that root owns and only root may write, by mode bits and by POSIX ACL;
  //   checked at every privileged call.
  prefixes: ['/etc/systemd/system', '/usr/local/bin'],
  // log: (line) => …, // default: one line on stderr per privileged call
});
// Provide linuxProviders(runner) alongside the stack's other provider layers.
```

⚠️ **Target: an ssh user that is NOT root, with passwordless sudo** —
`(ALL) NOPASSWD: ALL` on the sudoers line, as `homeflare-proxmox` declares for
`tim` on each Proxmox node. `sshRunner()` already covers an ssh user that IS
root; this is for the other case.

## Why `install` alone isn't enough here

macOS's `sudoRunner()` writes a file with one privileged call: `install -S`
stages a temp file beside the target and renames it, atomically, inside
`install` itself. **GNU `install` has no such mode** — it opens the
destination and writes through it (`src/linux/ssh-scripts.ts`'s own header).
So this runner does the staging and the atomic swap itself, across THREE
privileged calls instead of one:

| step | who      | what                                                                |
| ---- | -------- | ------------------------------------------------------------------- |
| 1    | operator | `mktemp -d` (0700), then `writeFileAtomic` the bytes into it (0600) |
| 2    | **root** | `install -m <4 octal> [-o uid] [-g gid] -T -- <staged> <temp>`      |
| 3    | **root** | `mv -f -T -- <temp> <dest>` — rename(2), same directory, atomic     |

`<temp>` is `<dest's directory>/.<basename>.hf-<12 hex>.tmp`, derived per
call and verified **absent** by the operator before step 2 runs. `install`
writes into a file NOTHING has opened yet, so "writes through" changes
nothing that mattered; `mv` is the one call that ever touches `<dest>`, and
rename(2) is atomic by construction. On any failure after step 2, step 3's
temp is removed with `sudo -n rm -f -- <temp>`; the operator's own staging
directory is removed either way.

## What runs as root: the whole list

Each is `/usr/bin/sudo -n -- <argv>`, every program by absolute path.

| when                                 | argv                                                                             |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| a file under a prefix — stage→temp   | `/usr/bin/install -m <0644> [-o <uid>] [-g <gid>] -T -- <staged> <temp>`         |
| a file under a prefix — temp→dest    | `/usr/bin/mv -f -T -- <temp> <dest>`                                             |
| a file under a prefix is removed     | `/usr/bin/rm -f -- <path>`                                                       |
| a directory under a prefix is made   | `/usr/bin/mkdir -m <octal> -- <path>`                                            |
| its mode is fixed                    | `/usr/bin/chmod <octal> -- <path>`                                               |
| its owner is fixed                   | `/usr/bin/chown <owner> -- <path>`, `<owner>` numeric `uid`, `:gid` or `uid:gid` |
| it is removed                        | `/usr/bin/rmdir -- <path>`                                                       |
| after any unit-file write/removal    | `/usr/bin/systemctl daemon-reload`                                               |
| a unit is enabled/disabled/started/… | `/usr/bin/systemctl <verb> -- <unit>`                                            |

`enable`/`disable`/`start`/`stop`/`restart` elevate only when the unit's
**own `FragmentPath`** (read first, as the operator, via `systemctl show`) is
either empty (no unit file — an already-deleted unit, so a second, idempotent
delete still works) or itself under a declared prefix. A vendor unit like
`pveproxy.service`, whose `FragmentPath` is `/usr/lib/systemd/system/…`, is
refused before sudo ever runs: this runner cannot touch what it did not
declare. `--user`, `--global`, `-H`, `-M` and `--root` are refused outright,
anywhere in the argv.

## What stays as the operator

- Every read: `stat`, `readFile`, user/group lookups, `systemctl show`.
- `checkWrite` — the plan-time half of a write, run at every plan so a
  refusal surfaces before any resource is applied, never at the write.
- Files and directories outside every prefix (a foreign owner there is a
  refusal naming the declared prefixes, not a silent write attempt).
- `ls -ldn` and `mktemp -d` — the guard's chain read and the write's own
  staging, both unprivileged (`src/linux/sudo-listing.ts`, `sudo-stage.ts`).

★ **So a plan never calls sudo**, and construction never does either:
`sshSudoRunner()` runs one combined, read-only `test -x` for the nine
absolute programs above, so a missing coreutils package or a systemd-free
container fails with a clear message at construction — never a sudo probe.

## The host guard

Before any privileged file or directory call, and in `checkWrite`, one
`ls -ldn` read (as the operator) covers every directory from `/` down to the
target's parent (`src/linux/sudo-listing.ts` — one ssh round trip for the
whole chain, because ssh pays a handshake per call with no multiplexing
unless the caller opts in). Refused: any directory in that chain not owned
by root, or writable by group or other; a POSIX ACL `+` flag anywhere in it
(the signal is the flag alone — `getfacl` is absent on the estate's Debian
hosts, so an ACL is refused whatever it grants, fail closed); a symlink at or
below the prefix; a target of the wrong kind for what is about to happen to
it (a directory sitting where a file write expects absent or a file, say).
A root-owned symlink **above** the prefix (Debian's merged-`/usr`, `/lib` ->
`usr/lib`) is the system's own and is followed, mirroring the Mac guard.

## Refused before sudo is asked

Same spirit as [launchd-sudo.md](./launchd-sudo.md)'s list: any argv whose
program is `sudo`; `install` from a source it did not stage, or to a target
that is not the temp it derived; `mv` whose source is not that same temp, or
whose destination is not under a declared prefix; `rm -r`; any of the
directory programs with an extra operand, a relative path, `..`, a
prefix-sibling (`/usr/local/bin-x` is not under `/usr/local/bin`), or a
`chown` by name instead of a numeric id; `systemctl mask`/`--user`; a
root-owned file that would be group- or world-writable, setuid or setgid; a
file the operator could not read back (both `Systemd.Unit` and `Remote.File`
read every write back to compare digests).

Every refusal throws `SudoRefusedError`: nothing ran as root. A privileged
command that ran and failed throws a plain `Error` with its exit code.

## What is measured vs reasoned

⚠️ **REASONED, NOT MEASURED — never run live** unless marked otherwise: the
write path (`install`→`mv`, `rm`, `mkdir`/`chmod`/`chown`/`rmdir`,
`daemon-reload`/`enable`/`disable`/`start`/`stop`/`restart`) has never been
run against a real host by this runner. Each is checked for exit 0 and its
effect read back, never assumed — the same discipline
[linux-host-measured.md](./linux-host-measured.md) already keeps for the
unprivileged writes.

★ **Exercised read-only against `n2` (Debian 13 / trixie, systemd 257
(257.13-1~deb13u1), coreutils 9.7-3, merged `/usr` — `/bin -> usr/bin`), ssh
user `tim` uid 1000, `(ALL) NOPASSWD: ALL`, 2026-09-23.** `sshSudoRunner()`
built successfully (the `test -x` construction check passed for all nine
programs); `checkWrite('/etc/systemd/system/hf-pve-cluster-check.service',
{mode:0o644, uid:0, gid:0})` and
`checkWrite('/usr/local/bin/hf-pve-cluster-check', {mode:0o755, uid:0,
gid:0})` both returned successfully (the real directory chain read as
root-owned, no group/other write, no ACL, both targets absent); a read-only
`systemctl show -p LoadState -- hf-pve-cluster-check.service` answered
`LoadState=not-found`. **The runner's own log stayed empty across every
call** — nothing was elevated. Nothing was written, enabled, started or
reloaded on `n2`.

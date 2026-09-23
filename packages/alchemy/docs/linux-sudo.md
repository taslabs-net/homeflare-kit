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
So this runner does the staging and the atomic swap itself:

| step | who        | what                                                                |
| ---- | ---------- | ------------------------------------------------------------------- |
| 1    | operator   | `mktemp -d` (0700), then `writeFileAtomic` the bytes into it (0600) |
| 2    | **root**   | `install -m <4 octal> -T -- <staged> <temp>` — no `-o`/`-g`, ever   |
| 3    | **root**\* | `chown +<uid>[:+<gid>]` — only when a non-root owner was declared   |
| 4    | **root**   | `mv -f -T -- <temp> <dest>` — rename(2), same directory, atomic     |

`<temp>` is `<dest's directory>/.<basename>.hf-<12 hex>.tmp`, derived per
call and verified **absent** by the operator before step 2 runs. `install`
never takes `-o`/`-g`: unlike `chown`, GNU `install`'s own `get_ids()`
(coreutils `src/install.c`) always tries `getpwnam`/`getgrnam` on the string
FIRST, with no way to force numeric parsing — so `install -o 0` on a host
that ever had a user literally named `"0"` would install owned by THAT
account, not uid 0. `install` therefore always leaves the temp owned by
whoever `sudo` ran it as (root:root), and a declared non-root owner or group
is set afterward by step 3's `chown`, which DOES support forcing numeric
parsing (`+<id>`, skipping the name lookup — gnulib's `userspec.c`). `mv` is
the one call that ever touches `<dest>`, and rename(2) is atomic by
construction. On any failure after step 2, the temp is removed with
`sudo -n rm -f -- <temp>` — if THAT also fails, the thrown error says so and
names the path, rather than leaving it a silent mystery. The operator's own
staging directory is removed either way.

## What runs as root: the whole list

Each is `/usr/bin/sudo -n -- <argv>`, every program by absolute path.

| when                                 | argv                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------- |
| a file under a prefix — stage→temp   | `/usr/bin/install -m <0644> -T -- <staged> <temp>`                                  |
| its owner, if not root:root          | `/usr/bin/chown +<uid>[:+<gid>] -- <temp>` — numeric, `+`-forced, bound to `<temp>` |
| a file under a prefix — temp→dest    | `/usr/bin/mv -f -T -- <temp> <dest>`                                                |
| a file under a prefix is removed     | `/usr/bin/rm -f -- <path>`                                                          |
| a directory under a prefix is made   | `/usr/bin/mkdir -m <octal> -- <path>` — never setuid/setgid or group/other-write    |
| its mode is fixed                    | `/usr/bin/chmod <octal> -- <path>` — same restriction                               |
| its owner is fixed                   | `/usr/bin/chown <owner> -- <path>` — **root only**: `+0`, `:+0` or `+0:+0`          |
| it is removed                        | `/usr/bin/rmdir -- <path>`                                                          |
| after any unit-file write/removal    | `/usr/bin/systemctl daemon-reload`                                                  |
| a unit is enabled/disabled/started/… | `/usr/bin/systemctl <verb> -- <unit>`                                               |

`enable`/`disable`/`start`/`stop`/`restart` elevate only when the unit is not
**masked** (`LoadState`, read alongside `FragmentPath` in the same call —
masking is someone's decision, never overridden here) and its **own
`FragmentPath`** is either under a declared prefix, or empty AND the verb is
`stop`/`disable` — the only two `unit-lifecycle.ts` `deleteUnit` ever sends
against a unit whose file it may just have removed, so a second, idempotent
delete pass still works. `enable`/`start`/`restart` with an empty
`FragmentPath` are refused, closing a kernel-generated pseudo-unit
(`init.scope`, a `session-N.scope`) as a target. A vendor unit like
`pveproxy.service`, whose `FragmentPath` is `/usr/lib/systemd/system/…`, is
refused before sudo ever runs: this runner cannot touch what it did not
declare. `--user`, `--global`, `-H`, `-M` and `--root` are refused outright,
anywhere in the argv. `directory-lifecycle.ts`'s own `chown` argv is bare
(`0`, `:0`, `0:0`); `canonicalize()` rewrites it to the `+`-forced form above
before the allowlist ever sees it, so the unprivileged caller never has to
know that syntax exists.

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
program is `sudo`; `install` with `-o`/`-g` at all (refused outright — see
above); `install` from a source it did not stage, or to a target that is not
the temp it derived; `chown` on the temp with a bare (non-`+`-forced) id, a
name, or a path that is not that exact temp; `mv` whose source is not that
same temp, or whose destination is not under a declared prefix; `rm -r`; any
of the directory programs with an extra operand, a relative path, `..`, a
prefix-sibling (`/usr/local/bin-x` is not under `/usr/local/bin`), or a
`chown` by name, a bare digit, or any non-root id; `systemctl mask`/`--user`;
a masked unit, any verb; `enable`/`start`/`restart` on a unit with no unit
file; a root-owned file that would be group- or world-writable, setuid or
setgid; a file the operator could not read back (both `Systemd.Unit` and
`Remote.File` read every write back to compare digests).

🔴 **Adversarial review, 2026-09-23, two rounds — everything found is fixed
and tested.** Round 1: a directory this runner elevates was checked for
SHAPE only, never mode or owner. `mkdir -m 0777` and `chown <non-root uid>`
both passed untouched, so a stack could declare `HostDirectory({ path:
'/etc/systemd/system/x.service.d', mode: 0o777 })`, drop an `ExecStart=`
override into it, and this runner's own next `daemon-reload` + `restart`
would run it as root. Fixed: a directory this runner elevates is now always
root-owned and never setuid/setgid or group/other-writable, unconditionally
— a directory's OWNER always has write access through the owner bits alone,
so no mode restriction alone could make a non-root-owned directory safe
here. The same round tightened the shared `modeProblem` check
(`../launchd/sudo-guard.ts`, used by both platforms): it exempted a file
merely because its `uid` was non-root, missing that `{uid: 501, gid: 0,
mode: 0o2775}` — setgid to root's own group — reaches the same escalation
through the group instead. Round 2 found the round-1 `modeProblem` fix was
itself incomplete (an OMITTED `gid`, not just an explicit `0`, defaults to
root's own group under `install` — see the section above), the masked-unit
and FragmentPath-scope gaps documented above, `install`'s own numeric-id
ambiguity (also above), and a swallowed cleanup-`rm` failure (now included
in the thrown error, with the leftover path named). All covered by tests:
`sudo-allowlist.test.ts`, `sudo-lifecycle.test.ts`, `sudo-runner.test.ts`,
`../launchd/sudo-modes.test.ts`.

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

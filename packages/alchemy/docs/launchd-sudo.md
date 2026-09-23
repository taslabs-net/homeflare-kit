# Deploying a Mac host as yourself — `sudoRunner()`

A host stack that declares system daemons needs root for a handful of calls. `sudoRunner()` lets
the deploy run as you (the operator) and sends **only those calls** through `sudo -n`, in fixed
argv shapes, logging each one. It is an explicit opt-in: nothing falls back to it, and
`localRunner()` stays the default and never elevates.

```ts
import { launchdProviders, sudoRunner } from '@homeflare/alchemy/launchd';

const runner = sudoRunner({
  // ⛔ Required: the directories root may write. Each — every directory above it, and every
  //   directory below it on the way to a file — must be one that root owns and only root may
  //   write, by mode bits and by ACL; that is checked at every privileged call.
  prefixes: ['/Library/LaunchDaemons', '/opt/example'],
  // log: (line) => …, // default: one line on stderr per privileged call
});
// Provide launchdProviders(runner) alongside the stack's other provider layers.
```

## What runs as root: the whole list

Each is `/usr/bin/sudo -n -- <argv>`, every program by absolute path, never through a shell.

| when                             | argv                                                                   |
| -------------------------------- | ---------------------------------------------------------------------- |
| a system job is bootstrapped     | `/bin/launchctl bootstrap system /Library/LaunchDaemons/<label>.plist` |
| a system job is booted out       | `/bin/launchctl bootout system/<label>`                                |
| (your own code, via `exec`)      | `/bin/launchctl kickstart [-k] [-p] system/<label>`                    |
| a file under a prefix is written | `/usr/bin/install -S -m <0644> [-o <uid>] [-g <gid>] <staged> <path>`  |
| a file under a prefix is removed | `/bin/rm -f -- <path>`                                                 |

- A file's bytes never reach argv or the log: they are written, as you, to a `0600` file in a
  fresh `0700` temp directory. `install` copies that file (and only that file) into place, and
  the temp directory is removed afterwards, whether or not the install succeeded.
- `install` writes a temp file beside the target and renames it (install(1) on macOS 27.2), so the
  target is never torn. `-S` adds the fsync.
- Owner and group are numeric ids, resolved by the provider before the call.

## What stays as you

- `launchctl print` and `print-disabled`. launchctl(1): "Anyone may read or query the system
  domain"; measured on macOS 27.2, too (see `src/launchd/launchctl.ts`).
- User and group lookups, `id -G`, every file read and `lstat`.
- Files outside every prefix, and your own `gui/<uid>` jobs.

★ So **a plan never calls sudo.** `read` and `diff` are reads; only an apply elevates.

★ **A plan that will write runs the checks below first** (`HostRunner.checkWrite`): a `HostFile`
or `LaunchdJob` diff that plans an update or a replace asks the runner, as you, whether it would
refuse that write. A refusal then fails the plan before any resource is applied, instead of the
apply halfway through. A create has no diff, so its refusal still comes at the write — before
sudo.

## Refused before sudo is asked

- Any other argv. That includes a bare `bootout system` (which removes the whole system domain),
  `bootstrap system <directory>` (which loads every plist in it), a plist anywhere but
  `/Library/LaunchDaemons/<label>.plist` (the only place launchd loads daemons from at boot),
  `rm -r`, `install -d`, a label under `org.nixos.`, `com.apple.` or `homebrew.mxcl.`, and any
  argv whose program is `sudo`.
- A system job's `bootstrap` or `bootout` when `/Library/LaunchDaemons` is not a prefix. ⚠️ Without
  it a delete would boot the job out, then fail to remove its plist, which launchd loads again at
  the next boot.
- A prefix that is missing, a symlink, not owned by root, or writable by group or other. ⛔ A
  symlinked prefix makes root write wherever it points, a path the log never names.
- **A directory between the prefix and the file** that is not owned by root, or that group or
  other may write (checked since 0.9.0). ⛔ Its owner, or anyone who may write it, could swap
  what lies under it for a symlink between the check and the call.
- **A directory above the prefix**, from `/` down, that is not owned by root or that group or other
  may write (red team, 2026-09-21). ⛔ Whoever may change the prefix's parent may rename the prefix
  away and put a symlink in its place: the same swap, one level up. A root-owned symlink among them
  (`/etc` -> `private/etc`) is root's own and is followed.
- **An ACL from `/` down to the file that grants a write right** (`add_file`, `add_subdirectory`,
  `delete_child`, `delete`, `write`, `append`, `writesecurity`, `chown`), read with `ls -lden` as
  you. ⛔ On macOS an ACL entry can hand another user exactly the swap the mode bits forbid, and an
  inheritable `allow write` hands them every file root installs there. Deny entries (a home
  folder's `everyone deny delete`) and read-only rights refuse nothing; ACLs that cannot be read
  refuse. Measured 2026-09-21: `/Library/LaunchDaemons`, `/private/etc`, `/opt` and `/usr/local`,
  and everything above them, carry none.
- **A root-owned file that would be group- or world-writable, setuid or setgid** (`mode & 0o6022`;
  root-owned means an omitted owner, uid `0`, **or gid `0`** — either alone keeps every check
  active). ⛔ Anyone in that class could rewrite a file root installed (a daemon's config, a script
  it runs), and a setuid root file runs as root for whoever executes it. 🔴 MEASURED (adversarial
  review, 2026-09-23): checking only `uid` let `{uid: 501, gid: 0, mode: 0o2775}` — setgid to
  root's own group, group-writable, merely OWNED by uid 501 — through untouched. A file handed to
  another owner is theirs to change only when its GROUP is genuinely theirs too.
- A path outside every prefix that needs root: another user as the owner, say.
- A symlink or missing directory between the prefix and the file, or anything but a regular file
  at the path. ⚠️ `install src <directory>` copies _into_ the directory, and a symlink to one does
  the same.
- A file you could not read back. Both providers read every write back, and read again at every
  plan, as you. A root-only `0600` would be installed, then fail with `EACCES` and stay on disk
  with no state. Membership comes from `id -G`, because macOS caps `getgroups()` at 16 (measured
  2026-09-21: 16 against 18).
- Another user's `gui/<uid>` or `user/<uid>` domain. Only the system domain is elevated.

Every refusal above throws `SudoRefusedError`: nothing ran as root. A privileged command that ran
and failed throws a plain `Error` with its exit code.

## When sudo wants a password

`sudo -n` never prompts. It fails at once, and the error says so: `a password is required, and
this runner never prompts`. The command did not run. You have two options.

1. **`sudo -v` just before the deploy.** This caches a ticket. By default it lasts 5 minutes and
   is tied to one terminal (sudoers(5): `timestamp_timeout`, `timestamp_type`).
   ⚠️ A deploy that outlives the ticket fails at its next privileged call. Every step is
   idempotent (Alchemy requires `delete` to be), so `sudo -v` and deploying again converges. The
   exception is a `LaunchdJob` label or domain change: it is delete-first, so if it fails between
   the delete and the create, the job is down until you redeploy.
2. **A `NOPASSWD` sudoers rule for exactly the shapes above.**
   - ⛔ **That rule is root-equivalent.** Anyone who may `install` into `/Library/LaunchDaemons`
     and `launchctl bootstrap system` can run any program as root. The allowlist protects you
     from mistakes, not from the account that holds the rule.
   - ⛔ **Never use wildcards in the arguments.** sudoers(5): in arguments, `*` also matches spaces
     and `/`, so `/bin/rm -f -- /opt/example/*` matches `../../etc/x` and two paths at once. Use
     `^…$` regular expressions (sudo 1.9.10 and later; macOS 27.2 ships 1.9.17p2) and forbid
     `..`. Check the file with `visudo -c -f <file>` before you install it.
   - ⚠️ The kit ships no tested rule. Nothing here has run sudo.

⚠️ The error text sudo prints is **reasoned, not measured**. It comes from sudoers(5) and sudo(8)
for sudo 1.9.17p2. A sudo refusal the runner does not recognise comes back as a failed command,
with sudo's own stderr.

## The log

Each privileged call logs one line before it runs:

```text
homeflare/launchd sudo -n ["/bin/launchctl","bootstrap","system","/Library/LaunchDaemons/com.example.exporter.plist"]
```

The argv is written as JSON, so a space in a path cannot hide a second argument. The line holds
the argv only, never file content. ⛔ A custom `log` should keep every line: the log is the only
record of what ran as root.

## Limits

- ⚠️ **Moving a job from `system` to another user's `gui/<uid>` passes the plan and fails at
  apply**, after the old job was already removed. The runner reports `privileged: true`, so the
  plan-time check lets it through, and the refusal only comes at the write. Do that move as a
  remove, then an add.
- ⚠️ **Under a prefix, the runner writes as root.** An omitted owner is root, and an omitted group
  is the directory's group (a new file's group on macOS).
- ⚠️ **The checks run as you, just before the call.** Every directory from `/` down to the file
  must be root-only, by mode bits and by ACL, so no other user can swap a path in between; root
  itself still could. The target of a root-owned symlink above the prefix is root's choice and is
  not walked.
- ⛔ **macOS hosts.** Every argv shape was checked against macOS 27.2 man pages.

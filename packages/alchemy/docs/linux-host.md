# Linux hosts — `@homeflare/alchemy/linux`

Status: active
Verified: 2026-09-22

The same `HostRunner` seam the [launchd subpath](./launchd.md) drives a Mac
through, pointed at a Linux host over ssh — plus the three resource families
that seam was missing: a directory, a file (whole, or one **managed block**
inside a file somebody else owns) and systemd units.

★ **What it unblocks.** A guest could be declared; nothing inside it could.
That one gap is what stood between Alchemy and a host's services.

## The seam

```ts
import { linuxProviders, sshRunner } from '@homeflare/alchemy/linux';

const runner = await sshRunner({ host: 'the-destination' });
Layer.mergeAll(linuxProviders(runner) /* the stack's other providers */);
```

- The destination is whatever the operator's own `~/.ssh/config` calls it.
- ⛔ **`BatchMode=yes`, always.** A deploy never stops to ask for a passphrase.
- ⛔ **Host verification is never weakened.** No `StrictHostKeyChecking`, no
  `UserKnownHostsFile`: a changed host key stays a refusal.
- ⛔ **Fail closed.** ssh exits 255 for its own failures _and_ passes remote
  codes through, so every remote script ends by printing its status behind a
  per-runner random nonce. A result without that line is an **Error**, never a
  "nothing is there". This is the rule that stops a dropped link reading as a
  deleted config.
- ⛔ **No silent sudo.** `privileged` is `false` and nothing here calls `sudo`.
  A root-owned path needs a destination whose ssh **user is root**, or
  `sshSudoRunner()` — the Linux twin of `sudoRunner()`, with its own argv
  allowlist: [linux-sudo.md](./linux-sudo.md).
- The probe at construction (`uname -s`, `id -u`) refuses anything that is not
  Linux: the scripts use GNU/BusyBox spellings (`stat -c`, `base64`, `mv -f`).

★ **Exercised read-only against a live host, 2026-09-22** (Debian 13, ssh user
uid 1001, nothing written): `stat` of a file, a missing path and a symlink — the
symlink reported as `symlink`, so the lstat contract holds over the wire —
`readFile` of a present and an absent path, `getent` user and group lookups, a
failing `exec`, and an argument containing a space, a `$`, a backtick and a `;`
arriving verbatim on the far side. That run is also what found the framing bug
below.

⛔ **The framing runs the script in a subshell, and that is not cosmetic.** The
scripts end a branch with `exit <code>` to say "nothing was there"; at the top
level that exit leaves the shell before the marker prints, and the caller
correctly reads a frameless result as a transport failure. 🔴 Measured: `stat` of
a missing path came back as "the remote command did not report a status (ssh exit
66)" instead of "nothing is at this path". A test now runs the real frame through
a real `/bin/sh`.

⚠️ One ssh connection per call. Pass `sshArgs: ['-o', 'ControlMaster=auto', …]`
to opt into your own multiplexing socket; the kit does not create one behind
your back, because a stale socket outliving the deploy is a surprise nobody
declared.

## `Host.Directory`

Every file resource refuses to create a parent, on purpose — creating one would
invent an owner and a mode nobody declared. This is the declaration that was
missing.

```ts
HostDirectory('app-etc', { path: '/opt/app/etc', mode: 0o750, owner: 'app' });
```

- ⛔ **One directory, never a chain.** A missing parent is a refusal that names
  it, so a tree is a chain of declarations whose modes are all in the plan.
- ⛔ **Delete is `rmdir`.** A directory that still holds files is a refusal;
  removing a declaration must not remove data the declaration never mentioned.
- `mkdir -m` carries the mode, so a umask never masks a declared bit.

## `Remote.File`

Whole-file mode is `Host.File` on Linux: content, mode, owner, group, an atomic
write (stage beside the target, chown, chmod, rename) and a read-back.

### Managed regions

```ts
RemoteFile('ssh-block', {
  path: '/etc/example.conf',
  region: { name: 'homeflare-example' }, // comment defaults to '#'
  content: 'one declared line\n',
});
```

produces, at the end of a file this resource does **not** own:

```
# BEGIN homeflare-example
one declared line
# END homeflare-example
```

- ⛔ **Every byte outside the markers is identical.** Not re-indented, not
  re-terminated. That is the whole reason the file's real owner tolerates this,
  and it is what `region.test.ts` asserts.
- ⛔ **Drift means the region, and nothing else.** A change elsewhere in the
  file is not this resource's business and never plans an update — otherwise
  the two owners fight on every deploy.
- ⛔ **The file's own mode and owner are copied back**, never re-declared.
  `mode`/`owner`/`group` are refused unless `create: true`.
- ⛔ **Ambiguity is a refusal.** Two BEGIN markers, an END before its BEGIN, or
  a BEGIN with no END each name the line rather than guess.
- **Delete removes only the block**, leaving the rest byte-identical.
- ⛔ **The region's name and comment token are its identity.** Changing either
  moves the block: the new one is written and verified, then the old one goes.
  Switching between whole-file and region mode at one path is refused.
- ⚠️ A file with no final newline gains exactly one when the block is appended.
  That is the only byte added outside the block, and it is not taken back.

⚠️ The write replaces the inode in both modes. A process holding the old file
keeps reading it until it reopens, and a hard link stops tracking — the price of
never leaving a torn file.

## `Systemd.Unit` and `Systemd.Timer`

```ts
SystemdUnit('thing', {
  name: 'thing.service',
  sections: [
    { name: 'Unit', lines: [['Description', 'a thing']] },
    { name: 'Service', lines: [['ExecStart', '/usr/bin/thing']] },
    { name: 'Install', lines: [['WantedBy', 'multi-user.target']] },
  ],
  restartOn: [config.sha256],
});
```

### What a deploy does NOT do

⛔ **It never mass-restarts.** A unit is restarted only when

1. its own unit file's bytes changed, or
2. state holds an older digest than the file does (a previous write landed and
   its reload never ran), or
3. systemd itself says `NeedDaemonReload=yes`, or
4. a digest the declaration listed in `restartOn` changed.

Nothing else. A re-run restarts nothing; an **adopted** unit that already
matches is not restarted, reloaded or even started. That is what lets this
family reach a host holding a vault, a clock or a UPS handler.

⚠️ **The limit, stated plainly:** a hand edit of a file named in `restartOn` is
_not_ noticed. The digest in state still matches what the stack declared, so the
unit reads converged — the same limit the Mac side records.

### The rest of the contract

- Order is **write, `daemon-reload`, enable/disable, then start/stop/restart**.
  systemd reads the unit file at reload, so a failed write leaves the old unit
  running rather than leaving nothing running.
- A failed start on a **create** removes the file this deploy wrote and reloads
  again, so the next deploy starts clean; on an **update** the file stays and
  state keeps the previous digest, so the next deploy retries.
- For `started: false`, only `ActiveState=active` is drift and gets stopped — `activating` is a
  timer-driven `Type=oneshot` mid-run and is left alone (`isUnitRunning`, unit-form.ts).
- ⛔ A **masked** unit is someone's decision, not drift: refused, never unmasked.
- ⛔ Deleting the declaration **stops the service** — stop, disable, remove the
  file, reload. A unit that must outlive its declaration is adopted, not deleted.
- A name or directory change is a **delete-first replace**: two unit files for
  one name cannot both be the one systemd reads. The new identity is checked
  at plan time, read-only — valid, writable, not masked, unclaimed, and the
  runner's own check on the new path — and the old unit must be deletable,
  before that swap is promised. A file byte-identical to this render is the
  declaration's own leftover, not someone else's unit. A rename the plan could
  not see (a name still an Output) gets the same checks at apply, before the
  old unit is stopped; one whose `content` is still an Output gets the checks
  that need only the name — deletable, writable, not masked — in the plan.

### The directive set is systemd's, not the kit's

There is no machine-readable schema of `systemd.unit(5)` directives to generate
from, so `renderUnit` renders **sections and lines verbatim** and claims to know
nothing about what the keys mean. What is validated is what an INI file must be
true of, plus two structural rules proved by systemd's own output:

- `enabled: true` needs an `[Install]` section — systemd's name for a unit file
  without one is `UnitFileState=static`;
- `enabled: true` needs a `directory` systemd searches by name. `systemctl
enable <name>` looks the unit up by name, so a file in `/opt` is invisible to
  it and the deploy would write, reload, and only then fail. The list is
  `systemd-analyze unit-paths`, measured below;
- a `.timer` needs a `[Timer]` section.

⛔ **Enablement is read back, never claimed.** After `enable` the state is taken
from `systemctl show`; a unit systemd still calls `static` or `disabled` is a
refusal, not an `enabled: true` written into state. Otherwise the next plan would
compare the declaration against itself.

★ Run `systemd-analyze verify` on the host for the deep check.

★ The exact commands, their output and what was **not** measured:
[linux-host-measured.md](./linux-host-measured.md).

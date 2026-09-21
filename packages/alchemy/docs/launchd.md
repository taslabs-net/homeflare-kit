# launchd — `@homeflare/alchemy/launchd`

Declare a Mac host with Alchemy: its launchd jobs (`LaunchdJob`) and the config files they read
(`HostFile`). launchd has no SDK, so the provider renders the plist itself and drives
`launchctl`. Every file read, file write and `launchctl` call goes through one injectable
`HostRunner`.

```ts
import * as Effect from 'effect/Effect';
import { HostFile, LaunchdJob, launchdProviders } from '@homeflare/alchemy/launchd';

export const exporter = Effect.gen(function* () {
  const config = yield* HostFile('exporter-config', {
    path: '/usr/local/etc/example-exporter.yml',
    content: 'listen: 127.0.0.1:9100\n',
    mode: 0o644,
    owner: 'root',
    group: 'wheel',
  });
  yield* LaunchdJob('exporter', {
    label: 'com.example.exporter',
    domain: 'system', // or 'gui/<uid>' for a LaunchAgent
    // ★ config.path, not the literal: the Output orders the job after its file is written.
    programArguments: ['/usr/local/bin/example-exporter', '--config', config.path],
    environment: { TZ: 'UTC' }, // ⛔ non-secret values only
    runAtLoad: true,
    keepAlive: { successfulExit: false },
    throttleInterval: 30,
    standardOutPath: '/var/log/example-exporter.log',
    standardErrorPath: '/var/log/example-exporter.log',
  });
});
// Provide launchdProviders() alongside the stack's other provider layers.
```

## LaunchdJob

| prop                          | plist key                        | notes                                                  |
| ----------------------------- | -------------------------------- | ------------------------------------------------------ |
| `label`                       | `Label`                          | also the file name; `[A-Za-z0-9._-]`, no `/`           |
| `domain`                      | —                                | `system` (LaunchDaemons) or `gui/<uid>` (LaunchAgents) |
| `programArguments`            | `ProgramArguments`               | first element must be an absolute path                 |
| `environment`                 | `EnvironmentVariables`           | ⛔ non-secret only (see below)                         |
| `runAtLoad`                   | `RunAtLoad`                      |                                                        |
| `keepAlive`                   | `KeepAlive`                      | `true`/`false` or `{ successfulExit, crashed }`        |
| `startInterval`               | `StartInterval`                  | seconds, > 0                                           |
| `startCalendarInterval`       | `StartCalendarInterval`          | one entry or a list; fields are range-checked          |
| `throttleInterval`            | `ThrottleInterval`               | seconds, ≥ 0                                           |
| `standardOutPath` / `…Error…` | `StandardOutPath` / `…ErrorPath` | absolute                                               |
| `workingDirectory`            | `WorkingDirectory`               | absolute                                               |
| `userName` / `groupName`      | `UserName` / `GroupName`         | system domain only — launchd ignores them for agents   |
| `extraKeys`                   | anything else, verbatim          | may not repeat a key a typed prop owns                 |

The plist path is derived, never declared: `/Library/LaunchDaemons/<label>.plist` for `system`,
`<home of uid>/Library/LaunchAgents/<label>.plist` for `gui/<uid>`.

| step    | what happens                                                                                        |
| ------- | --------------------------------------------------------------------------------------------------- |
| create  | write the plist atomically (system: `root:wheel 0644`), then `launchctl bootstrap`                  |
| update  | write, `bootout` the running job (and wait until launchd lets go), `bootstrap` — **a restart**      |
| read    | `launchctl print` (loaded? state, pid, last exit) plus the SHA-256 of the plist on disk             |
| diff    | the rendered plist's SHA-256 against the stored digest **and** the on-disk one, plus "is it loaded" |
| replace | only when `label` or `domain` changes — **delete first**, so two copies never run at once           |
| delete  | `bootout` if loaded, remove the plist; idempotent                                                   |

- A converged job is not restarted: a retried deploy that finds the right plist loaded does nothing.
- ⚠️ A failed `bootstrap` leaves the job **down**, with the new plist on disk. The error says so,
  the state keeps the old digest, and the next deploy retries. There is no automatic rollback.
- ⛔ A label disabled with `launchctl disable` is refused, not re-enabled: that was someone's
  decision. The error names the `launchctl enable` command to run if it is stale.
- ⚠️ A `gui/<uid>` job needs that user logged in: without a login session the domain does not
  exist, and `launchctl` fails the deploy.
- ⚠️ The digest covers the rendered bytes, so a kit upgrade that changes the renderer's output
  restarts every declared job on the next deploy. Such a release says so in its changelog.

## HostFile

`path` (absolute, normalised), `content` (UTF-8 text), `mode` (default `0o644`), `owner` and
`group` (names or ids). Written as a temp file in the same directory — mode and owner set before
it becomes visible — then renamed over the path. Read back after every write. Diffed by SHA-256,
mode and owner. A new `path` is a create-before-delete replace. Delete removes the file.

- ⛔ A symlink or directory at the path is refused, never replaced: rename over a symlink replaces
  the link, which takes the path from whatever tool owns it (nix-darwin's `/etc` entries point
  into `/nix/store`).
- ⚠️ The parent directory must exist. Creating it would invent an owner and mode nobody declared.

## ⛔ No secrets in props

Alchemy stores props and attributes **unencrypted** in its state store. A job's `environment` and
`programArguments`, and a file's `content`, land there, in every plan diff, and on disk.

**Keep secret files rendered by a secret renderer** — `openbao-agent` templates on a HomeFlare
host — and declare only the path: `FOO_TOKEN_FILE=/path`, `--token-file /path`. A tripwire refuses
the obvious mistakes (a `*_TOKEN`/`*_PASSWORD`-style variable, `--token=…`, a PEM private key); it
is not a scanner, and passing it does not make a value safe to declare.

## ⛔ No silent sudo

The `system` domain, and another user's `gui/<uid>`, need root. The provider refuses up front
unless the runner is root (`effectiveUid() === 0`) or was deliberately built with
`privileged: true`. `localRunner()` — the default — is never privileged and never calls `sudo`, so:

- **system daemons:** start the whole deploy as root; or pass `launchdProviders(yourRunner)` where
  `yourRunner` is a `HostRunner` you wrote that already holds root (a root helper, say).
- **your own agents** (`gui/<your uid>`): no root needed.

Reading (`launchctl print`, `print-disabled`) needs no root. ⚠️ A `HostFile` whose mode hides it
from the planning user (a root-owned `0600`, say) fails the plan with `EACCES`: plan as the user
you deploy as.

## Adoption: nothing is taken over silently

`read` with no prior state reports anything it finds — a loaded label, a plist, a file — as
`Unowned`, so Alchemy refuses to take it over without `--adopt`.

Labels under `org.nixos.`, `com.apple.` and `homebrew.mxcl.` are **refused outright**. nix-darwin
rewrites its plists on every activation and unloads any it no longer lists, macOS owns
`com.apple.*`, and `brew services` owns `homebrew.mxcl.*`. Adopting one would give a file two
owners. Move the job instead.

## Cutover from nix-darwin

Nix-managed `org.nixos.*` jobs are **not adopted**. The host stack declares a **new** label, and the
Nix job is booted out first. Per job:

1. **Declare** the replacement in the host stack under a new label (`com.example.<job>`), with its
   config as `HostFile`s. ⚠️ Nothing it references may live in `/nix/store` — the next garbage
   collection deletes it. Plan it: expect creates only.
2. **Remove the job from the nix-darwin config and activate.** Activation unloads and deletes every
   daemon it no longer lists — checked 2026-09-21 in a nix-darwin activation script: it prints
   `removing service <label>`, runs `launchctl unload`, then removes the plist. Confirm with
   `launchctl print system/org.nixos.<job>` → exit 113 ("Could not find service").
3. **Deploy** the host stack. The new label bootstraps.
4. **Verify** `launchctl print system/com.example.<job>` shows `state = running`, then check the
   service itself (port, metrics, logs).

- ★ **Why this order.** Both jobs usually bind the same port and write the same files; the old one
  must be gone before the new one starts. Downtime is one deploy.
- ⚠️ **`sudo launchctl bootout system/org.nixos.<job>` is not a cutover.** The next Nix activation
  copies the plist back and `load -w`s it, and then two copies fight over the port.
- **Rolling back** is the same three steps reversed: destroy (or remove) the resource, restore the
  job in the Nix config, activate.

## The runner

`HostRunner` (see `src/launchd/runner.ts`) is `exec(argv)` (never through a shell), `readFile`,
`stat` (lstat), `writeFileAtomic`, `removeFile`, `lookupUser`, `lookupGroup`, `sleep`, plus
`privileged` and `effectiveUid()`. `localRunner()` implements it with `node:fs` and
`node:child_process`; tests use an in-memory fake, so nothing in the test suite runs `launchctl` or
writes outside a temp directory.

---
'@homeflare/alchemy': minor
---

Add the `@homeflare/alchemy/launchd` subpath, so a Mac host can be declared with Alchemy.

- `LaunchdJob` / `LaunchdJobProvider` (`Launchd.Job`): one launchd job in the `system` domain or a `gui/<uid>` domain. The provider renders the plist itself, writes it atomically to the derived path (`/Library/LaunchDaemons` or the user's `LaunchAgents`) and drives `launchctl`. Create bootstraps; update writes, boots out and bootstraps (a restart); read uses `launchctl print`; diff compares the rendered plist's SHA-256 with the stored and on-disk digests. Replace happens only on a `label` or `domain` change, delete-first — so everything the new job would be refused for is refused at plan time, while the old job still runs, and a rename is seen even while other props are unresolved. A label another job already holds is never booted out or overwritten. A failed first bootstrap removes the plist it wrote. A disabled label is refused, not re-enabled. Labels under `org.nixos.`, `com.apple.` and `homebrew.mxcl.` are refused; `docs/launchd.md` describes the nix-darwin cutover.
- `HostFile` / `HostFileProvider` (`Host.File`): a text file with mode, owner and group. It is written atomically (temp file, then rename), diffed by SHA-256, mode and owner, and refused over a symlink, a directory, or a different file at a new path.
- `HostRunner`, `localRunner()`, `hostRunnerLayer()` and `launchdProviders()`: every filesystem and `launchctl` call goes through one injectable runner. The local runner never elevates. System-domain writes are refused unless the deploy runs as root or the runner is explicitly `privileged`.
- `renderPlist`: a small, deterministic XML plist serializer, round-tripped through `plutil` in the tests.

Props are stored unencrypted in Alchemy state, so `environment`, `programArguments` and file `content` must not hold secrets. A tripwire refuses the obvious cases; secret files stay rendered by openbao-agent, and the stack declares only their path. Anything already on the host is read as `Unowned`, so it is never adopted without `--adopt`.

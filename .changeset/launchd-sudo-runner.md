---
'@homeflare/alchemy': minor
---

Add `sudoRunner()` to `@homeflare/alchemy/launchd`, so a host stack can deploy as the operator
instead of as root.

- **Only the calls that need root use `sudo -n`, in fixed argv shapes.** These are
  `launchctl bootstrap | bootout | kickstart` in the system domain, and `install` / `rm` of a file
  under a prefix the stack declares. A file is written as the operator to a private `0600` temp
  file, then copied into place with `install -S -m <mode> -o <uid> -g <gid>`. Nothing else runs
  as root, and a plan never calls sudo.
- **It is opt-in:** `launchdProviders(sudoRunner({ prefixes }))`. `localRunner()` stays the
  default and never elevates, and nothing falls back to sudo.
- **It never prompts.** A password-required `sudo -n` fails at once with `SudoRefusedError`, and
  the message says to run `sudo -v` or to grant exactly these commands `NOPASSWD`.
- **Each privileged argv is logged before it runs.** The log holds the argv only, never file
  content.
- **These are refused before sudo is asked, with `SudoRefusedError`:** any argv outside the
  allowlist (such as a bare `bootout system`, a directory `bootstrap`, or a plist anywhere but
  `/Library/LaunchDaemons/<label>.plist`), a system `bootstrap` / `bootout` without
  `/Library/LaunchDaemons` among the prefixes, a prefix that is not a real directory only root may
  write, a path outside every prefix that needs root, a symlink between the prefix and the file, a
  file the operator could not read back, and another user's `gui/<uid>` domain.

`docs/launchd-sudo.md` has the full list, the sudoers cautions, and the limits.

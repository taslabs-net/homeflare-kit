---
'@homeflare/alchemy': minor
---

⚠️ **BEHAVIOUR CHANGE — `@homeflare/alchemy/openbao` no longer adopts anything silently.** Until
0.8.0, every `Bao.*` family adopted a live object it had no state for: a new declaration of a
policy, role, mount, auth method, plugin or MFA object that already existed was taken over, and
rewritten, without being asked. **A stack that relied on that must now add `adopt(true)` to those
resources, or deploy once with `--adopt`.** Otherwise its next plan fails with
`OwnedBySomeoneElse` ("Cannot adopt resource … Re-run with `--adopt`").

- **Every `Bao.*` family (all 14).** With no state row, a live object reads as `Unowned`, even when it
  is identical to the declaration. Identical is not proof of ownership: under `destroy`, the old
  owner's delete would remove the object the new declaration had just claimed. The plan fails
  unless adoption is on. This is the rule `HostFile`, `LaunchdJob` and `CaddyConfig` already
  follow. The 0.8.0 swap (a new logical id for a live name, then the old id's delete) now fails the
  plan and writes nothing.
- **Crash recovery still works without `--adopt`** when the state row can prove the object ours.
  Alchemy's recovery read for an interrupted create carries that row's own instance id, and the
  object is ours when the row carries the whole declaration and the object matches it. An
  interrupted replace resumes only when its `diff`, asking the family's own `read` the same
  question, proves it. A create interrupted between two writes (a mount enabled but not tuned), or
  killed while a prop was still an Output, is not proven ours, so it needs `--adopt`.
- **The same check at apply.** Alchemy skips the probe while a prop is still an Output, and never
  probes the new generation of a replace. Each family's `reconcile` now reads the object first and
  refuses the takeover before any write, unless `--adopt` or the resource's own `adopt(…)` allows
  it, resolved as the planner resolves it. A refused create also forgets the `creating` row Apply
  wrote, so the next plan does not adopt what the apply refused. A `BaoMount` / `BaoAuthMethod`
  create with `remountFrom` refuses to move a live mount the stack holds no state for.
- **`HostFile` and `LaunchdJob`: `--adopt` now works at apply.** Their `reconcile` refused a
  foreign file or job even under `--adopt`, where the probe had been skipped. A create now takes it
  over when adoption is on — a create or an interrupted generation, never a fresh replace's.
  `adopt(false)` still wins over the flag. A rename onto an occupied path or label stays refused,
  `--adopt` or not.
- **`sudoRunner()` refuses more, before sudo** (⚠️ a declaration that 0.8.0 accepted can now fail):
  - a root-owned file under a prefix that would be group- or world-writable, setuid or setgid
    (`mode & 0o6022`; an omitted owner is root);
  - any directory between the prefix and the file that root does not own, or that group or other
    may write. Before, only the prefix itself was checked.
  - A `HostFile` or `LaunchdJob` plan that will write now runs these checks too, through the new
    optional `HostRunner.checkWrite`, so the refusal fails the plan instead of the apply. It only
    reads, as the operator: a plan still never calls sudo.

New: `docs/ownership.md` (the rule, where it is checked, recovery, limits). `docs/launchd-sudo.md`,
`docs/launchd.md` and the openbao README and REPLACE.md are updated.

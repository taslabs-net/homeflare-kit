---
'@homeflare/alchemy': minor
---

⚠️ **BEHAVIOUR CHANGE — three silent takeovers closed, and `sudoRunner()` refuses more.** Found by an
adversarial review of the ownership rule above, each measured through Alchemy's own plan and apply
before the fix, and each now refused, writing nothing:

- **A `Bao.*` create killed before its ownership check no longer resumes onto someone else's object.**
  Apply writes the `creating` row before `reconcile` runs, and drops any prop still an `Output`
  from it. With the name an Output, the next deploy "resumed" that create and wrote over another
  owner's role (all nine role and MFA families, and `Bao.Mount` by path). With a knob an Output,
  `Bao.Mount` and `Bao.AuthMethod` read the missing prop as "not managed", adopted another owner's
  mount and tuned it. A state row now proves an object ours only when it carries every value the
  declaration names, and a resume is let through only when the family's own `read` proves the
  object that generation's. **So a create killed while a prop was still an Output now needs
  `--adopt` to resume.**
- **An interrupted `Bao.*` replace no longer writes over what another owner put at its new
  identity since**, unless `--adopt`.
- **`--adopt` at apply now covers a create or an interrupted generation, never a fresh replace's
  new generation**, for every `Bao.*` family, `HostFile` and `LaunchdJob`. The planner never
  offers adoption there, yet a deploy-wide `--adopt` let a `HostFile` whose path changed overwrite
  a file it did not own at the new path.
- **`sudoRunner()` also refuses** (⚠️ a prefix 0.8.0 accepted can now fail): a directory _above_ the
  prefix, from `/` down, that root does not own alone (whoever may write the prefix's parent can
  swap the prefix itself; a root-owned symlink such as `/etc` is still followed), and any ACL entry
  from `/` down to the file that grants a write right (read with `ls -lden`, as the operator; deny
  entries pass; unreadable ACLs refuse). Both run before sudo and, through `checkWrite`, at plan
  time.

`docs/ownership.md` and `docs/launchd-sudo.md` carry the details and the limits.

---
'@homeflare/alchemy': minor
---

`Forgejo.TeamMember` now declares `defaultRemovalPolicy: 'retain'`, matching `Forgejo.Repository`
and `Forgejo.OrgLabel`. Previously the family had no default, so alchemy's own engine fallback
(`destroy`) applied: dropping a `TeamMember` declaration from a stack — a feature gate toggled off,
a resource id renamed — called `organization.orgRemoveTeamMember` and revoked a real membership on
live Forgejo, with no way to tell from the declaration alone that this would happen. Found in
`homeflare-mini` PR 82's red team (970e8be), which had to pipe every `ForgejoTeamMember(...)` call
through `.pipe(RemovalPolicy.retain())` by hand to avoid dropping `forgejo-provision` from `Owners`.

A stack that means to remove a real membership still can, with `.pipe(RemovalPolicy.destroy())` —
`destroy` was, and stays, fully implemented. A stack already piping `RemovalPolicy.retain()` by hand
(homeflare-mini) is unaffected; the pipe is now redundant, not wrong. Bumped as `minor`, not `patch`:
this changes what removing a declaration does, not just an internal detail.

⚠️ **The new default does not protect an existing row until you deploy once first.** Alchemy plans
a removal from the policy saved on that resource's state row, not from this default — the default
only reaches an already-existing row's state on a deploy where the resource is otherwise a no-op
(alchemy rewrites the row and logs `removal policy destroy → retain`). Concretely:

- **To adopt retain for a `TeamMember` declared before this bump:** deploy the version bump first,
  with the declaration left in place (a no-op plan updates the saved policy). Only remove the
  declaration in a later deploy.
- **Dropping the bump and the declaration in the SAME deploy still deletes the live membership** —
  the plan reads the row's old `destroy` policy, not this new default.
- **To revoke a membership on purpose**, the sequence is unchanged: deploy with
  `.pipe(RemovalPolicy.destroy())` first, then remove the declaration in a later deploy.

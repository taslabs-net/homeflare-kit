---
'@homeflare/alchemy': patch
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
(homeflare-mini) is unaffected; the pipe is now redundant, not wrong.

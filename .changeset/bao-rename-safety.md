---
'@homeflare/alchemy': minor
---

Rename safety for `BaoPolicy`, `BaoCloudflareRole` and `BaoProxmoxRole` in `@homeflare/alchemy/openbao`.

Behaviour changes:

- A changed `name` on `BaoPolicy`, or a changed `mount` or `name` on `BaoCloudflareRole` or `BaoProxmoxRole`, now plans `replace`. Before, it planned `update`: the new object was written and the old one stayed live with no state record, even under `RemovalPolicy.destroy()`. Now the old one is deleted after the new one is written, or kept under the default `retain`, and the apply says so.
- `BaoPolicy` compares names the way OpenBao stores them, trimmed and lowercased, so a change of case is not a rename.
- A `BaoProxmoxRole` rename that also changes `mintUser` now fails the plan unless `allowMintUserChange` names the old mint user, the same rule an in-place re-scope already had.
- A rename or move onto a name or path that already exists live now fails the plan, before anything is written. Without this, two policies or roles that swapped names under `RemovalPolicy.destroy()` both planned `replace` and ended with both deleted. The check also applies under `retain`, because a diff cannot see the removal policy: a swap, or a move back onto a retained old generation, now takes two deploys through a free name, or removing the target by hand.
- When the new name is an Output that is not known until apply, reconcile now refuses the `update` before writing anything. The next deploy plans `replace`. A `BaoProxmoxRole` rename whose `allowMintUserChange` is still an Output defers the same way instead of failing the plan.

The rename is checked even while other props are still pending Outputs. `src/openbao/REPLACE.md` has the measured engine behaviour and what `retain` leaves live for each of the three.

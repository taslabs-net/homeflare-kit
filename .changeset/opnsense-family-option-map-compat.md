---
'@homeflare/alchemy': patch
---

Compatibility fix for the already-merged `opnsense/*` family (PR #236),
made necessary by this PR's `@homeflare/distilled-opnsense` SDK bump: the
whole-model `get()` this family's `Opnsense.Firewall.Alias`/`Opnsense.Firewall.Group`
`fetchLive` reads now correctly decodes list-shaped fields (`type`,
`interface`, `proto`, `categories`, `members`, `content`) as OPNsense's
real option-map shape `{key: {value, selected}}`, not a string — see the
SDK PR's OPNSENSE-2 fix.

This surfaces (and fixes) a real, previously-masked bug rather than
introducing one: `alias-form.ts`'s old `csvSet(live.categories)` called
`.trim()` on what the pre-fix SDK typed as a string — the exact crash
class the SDK PR's changeset describes for the live homeflare-network
import — just never hit here because this family's own tests used a fake
OPNsense returning string-shaped fixtures that matched the bug instead of
the real wire. `wire.ts`'s new `selectedOf`/`selectedOneOf` extract the
selected key(s) back to the plain string/string[] shape
`AliasAttributes`/`GroupAttributes` already declared, so `matches` and the
declaration renderer (`propsFromLive`) are behaviorally unchanged for any
already-correct declaration.

No live-plan impact expected: this is the read path decoding correctly
for the first time against a real option-map response, not a change to
what a declaration renders or what `matches` reports for a value that was
already being read successfully (a value that decoded as `[object Object]`
or threw before this fix could never have matched a real declaration
anyway).

**Still held for the follow-up PR** (per the SDK PR's own note): switching
`Category`/`Group` to their now-correct per-item `getCategory`/`getGroup`
(OPNSENSE-1) instead of whole-model `get()`, `catchTag` typed errors, a
delete-of-absent test and a transient-read-propagates test.

**The opnsense family is correct for consumers only after the alias pin
moves to the released `distilled-opnsense`.** `packages/alchemy/
package.json` still pins `"@distilled.cloud/opnsense": "npm:@homeflare/
distilled-opnsense@0.2.0"` exactly — this PR does not bump it. The bun
workspace links the local package during development, which is why this
fix's tests and this repo's own pre-push gate pass, but a published
`@homeflare/alchemy` consumer installs the pinned `0.2.0` from npm, which
still cannot decode option maps, underneath family code that now expects
them. Moving the pin is a separate, later PR, once `@homeflare/
distilled-opnsense` has actually released (the same two-step precedent as
kit commit `06591c9` / PR #206).

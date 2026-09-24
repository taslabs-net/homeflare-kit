---
'@homeflare/alchemy': minor
---

`grafana/*` ships `Grafana.ContactPoint`, `Grafana.MuteTiming` and `Grafana.MessageTemplate` — the
first of three stacked PRs bringing Grafana alerting provisioning under Alchemy (decision 40: every
internal alert lands in one place), on the same `@distilled.cloud/grafana@0.2.0` operations that
unblocked `Grafana.Folder`/`Grafana.Dashboard`. `Grafana.AlertRuleGroup` and
`Grafana.NotificationPolicy` follow in two later PRs. Full detail, including what was measured
against the SDK's generated types versus Grafana's own docs (no live call was made in this PR):
`docs/grafana-alerting.md`.

**Shared across the family:** a foreign-provenance refusal (`alerting-provenance.ts`) — every
resource reads Grafana's own `provenance` field and refuses a write when it names an owner other
than this API (an allowlist of `""`/`"api"`, not a denylist of the known foreign values, so an
unnamed future provenance source refuses by default). This is defense in depth: Grafana's alerting
provisioning API also enforces it server-side, unlike the classic folder/dashboard write API. No
resource in this family ever sets `X-Disable-Provenance` — an object this family declares stays
owned by the declaration.

⛔ **Fixed after an adversarial review of this PR: the guard failed OPEN.** The first version
mapped `live.provenance ?? ''`, so a response that simply omitted the field was indistinguishable
from an explicit `""` (`ProvenanceNone`, writable) — a real risk for `Grafana.MuteTiming`
specifically, whose `provenance` isn't even in the SDK's declared type and survives only through an
unmodeled-key passthrough this house has never observed against a live response. `undefined` is now
kept as its own value all the way through `isForeignProvenance`/`refuseIfForeignProvenance`: ONLY a
field Grafana explicitly reports as `""` or `"api"` is writable; a missing field refuses, with a
message that says so. Every resource has a test pinning all three cases (missing refuses, explicit
`""` is writable, `"file"` refuses).

**`Grafana.ContactPoint`:** no by-uid GET route exists (measured), so `fetchLive` lists every
contact point and matches `uid` client-side rather than narrowing by the renameable `name` label. A
secure `settings` key is never a literal prop — `secureSettingsRefs` names it, resolved from an env
var fresh at write time and merged into `settings` only there (`secret-refs.ts`, extracted from
`Grafana.Datasource`'s identical `secureJsonDataRefs` seam so both share one implementation).
`matches` excludes every `secureSettingsRefs` key from comparison entirely, since Grafana's plain
GET always redacts a secure field.

**`Grafana.MuteTiming`:** a genuine SDK finding worth restating here — the generated
`MuteTimeInterval` type has no `provenance`/`version` fields, and its `TimeInterval` type is
missing the real Alertmanager time-interval fields (`weekdays`/`times`/`months`/etc.) entirely, even
though Grafana's real API sends and accepts all of them. Proven NOT to be a data-loss gap:
`@distilled.cloud/core`'s response decoding never runs a strict schema decode, only `JSON.parse`
plus a key-rename pass that leaves any key a type doesn't model verbatim — confirmed by driving the
real operation through this family's own fake-Grafana test harness. `mute-timing.ts` reads/writes
through a small locally-widened type instead of the SDK's own. Tracked in
`docs/upstream-conformance.md` as a real SDK type-generation gap (the same fix route as the other
named gaps there) — not attempted here, since `packages/distilled-grafana/src/` is vendored code
this kit never hand-edits.

**`Grafana.MessageTemplate`:** create and update are the same `PUT` wire call — measured, no
`routePostTemplate` exists — kept as two spec functions anyway so the shared engine's `diff` reports
a content change as `update`, not the `replace` it shows for any resource whose `spec.update` is
undefined.

Tests (`contact-point.test.ts` + `contact-point-secrets.test.ts` + `contact-point-provenance.test.ts`,
`mute-timing.test.ts`, `message-template.test.ts` — `ContactPoint`'s split three ways to stay under
the house's 250-line file cap) use the family's existing `fake-grafana.ts` harness and prove: a GET
never carries a body; a foreign-provenance object (explicit `"file"` or a MISSING field) refuses
update/destroy with no write sent, and an explicit `""` is writable; a transient failure (401/403)
propagates rather than folding to absent; an unchanged declaration is a noop despite an injected
field the declaration never mentioned; and, for `Grafana.ContactPoint`, that a secret value never
appears in a real `reconcile`'s returned attributes (not just in the declaration, which never held
it to begin with) — driven end to end through create, then the read-back `resource.ts` always does.
`subset-match.ts`'s array-length rule is flagged as unverified against a live mute timing and pinned
by its own test, per the same review.

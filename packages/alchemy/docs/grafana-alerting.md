# Grafana alerting provisioning — `@homeflare/alchemy/grafana`

Declares Grafana's alerting-provisioning objects (decision 40: every internal alert lands in one
place). Ships in three stacked PRs, in the order this file's own history records:

1. **`Grafana.ContactPoint`, `Grafana.MuteTiming`, `Grafana.MessageTemplate`** — this file, kit
   PR 250.
2. **`Grafana.AlertRuleGroup`** — [grafana-alerting-rules.md](./grafana-alerting-rules.md), a
   separate stacked PR (its own diff off `main`, not this one) once this file's doc budget filled.
3. Next: `Grafana.NotificationPolicy` — the singleton policy tree, last on purpose (it references
   contact points, mute timings and templates by name).

All three ship on the same `@distilled.cloud/grafana@0.2.0` operations
[grafana.md](./grafana.md#the-sdk-gap--history-and-what-shipped-on-top-of-the-fix) already
unblocked (`skipDeprecated` patched false for the 32 alerting-provisioning-write operations). No
live call was made writing this PR — see "Measured vs inferred" below.

## Foreign-provenance refusal — shared, `alerting-provenance.ts`

Every resource in this family reads a `provenance` string off what Grafana returns and refuses to
write when it names an owner other than this API. **Measured against Grafana's own source**
(`pkg/services/ngalert/models`, not re-fetched live): `ProvenanceNone = ""` (unclaimed),
`ProvenanceAPI = "api"` (this API's own writes), `ProvenanceFile = "file"`,
`ProvenanceConvertedPrometheus = "converted_prometheus"`. `alerting-provenance.ts`'s
`WRITABLE_PROVENANCES` is an **allowlist** of `{"", "api"}`, not a denylist of the two named
foreign values — an unnamed future provenance source refuses by default, the safer failure
direction for a control-plane write. Corroborated by Grafana's docs
(grafana.com/docs/grafana/v13.1/alerting/set-up/provision-alerting-resources/http-api-provisioning/),
whose example payloads show exactly `"api"` and `"file"`.

This is **defense in depth, not the only guard**: Grafana's alerting provisioning API also enforces
this server-side (grafana/grafana#103597, "Unable to delete file provisioned alert rules," reports
the block firing) — unlike the classic folder/dashboard write API `provisioned.ts` guards, which
has no such server-side check at all. `create` is never at risk for any resource below: it only
runs when `fetchLive` already found nothing.

⛔ **A missing `provenance` field is treated as foreign, never as `ProvenanceNone` — fixed after an
adversarial review of this PR found the guard failing OPEN.** The first version mapped
`live.provenance ?? ''`, collapsing "the field is absent" into "the field is explicitly empty" —
both writable. `isForeignProvenance`/`refuseIfForeignProvenance` now keep `undefined` as its own
value: only a field Grafana explicitly reports as `""` or `"api"` is writable. Every resource below
has a test pinning all three cases (missing refuses, explicit `""` is writable, `"file"` refuses).

`X-Disable-Provenance` is **never set** by any resource in this family. Every create/update
therefore leaves the object at `provenance: "api"` — Grafana's own default for an API write, which
blocks UI edits afterward. Deliberate: an object this family declares should stay owned by the
declaration, the "one owner per resource" posture `provisioned.ts` already established for
folders/dashboards.

## `Grafana.ContactPoint`

```ts
import { GrafanaContactPoint, grafanaProviders } from '@homeflare/alchemy/grafana';

export class OncallSlack extends GrafanaContactPoint('oncall-slack', {
  uid: 'slack-oncall',
  name: 'On-call Slack',
  type: 'slack',
  settings: { recipient: '#oncall' },
  secureSettingsRefs: { url: 'GRAFANA_SLACK_WEBHOOK_URL_ENV' },
}) {}
```

- **No by-uid GET route exists** — measured: `services/grafana.ts` has only `routeGetContactpoints`
  (list, optional `name` filter) and its export sibling. Narrowing that GET to the declared `name`
  is not safe either: `name` is a renameable grouping label (Grafana's own doc: "used as grouping
  key in the UI"), so `fetchLive` lists every contact point unfiltered and matches `uid`
  client-side — the same ambiguity `resource.ts`'s header and netbox's `soleMatch` name.
- **Secrets never appear as a literal prop (S25).** A secure `settings` key (a webhook URL, an API
  key, …) is named in `secureSettingsRefs` (field -> env var NAME), resolved fresh inside
  `create`/`update`'s own effect and merged into `settings` only there. Grafana's plain GET has no
  `decrypt` option (only the export route does, org-admin only) — a secure key always comes back
  redacted, so `matches` excludes every `secureSettingsRefs` key from comparison entirely, even if
  `settings` also names it with a stale placeholder value (`contact-point.test.ts`'s own test for
  this). Non-secret `settings` compares via `subset-match.ts`'s `declaredContentMatches`, tolerating
  a default Grafana injects that the declaration never mentioned.

## `Grafana.MuteTiming`

```ts
import { GrafanaMuteTiming, grafanaProviders } from '@homeflare/alchemy/grafana';

export class Weekends extends GrafanaMuteTiming('weekends-mute', {
  name: 'weekends',
  timeIntervals: [{ weekdays: ['saturday', 'sunday'] }],
}) {}
```

- ⚠️ **A genuine, surprising SDK finding, worth restating here.** The generated `MuteTimeInterval`
  type declares only `name`/`time_intervals` — no `provenance`, no `version`, unlike every other
  type this family reads. A first pass assumed the data was gone; empirically it is not:
  `@distilled.cloud/core`'s response decoding is `JSON.parse` + a key-rename pass, never a strict
  schema decode — any key a type doesn't model passes through **verbatim** (`protocol-http.ts`'s
  `mapKeys`, confirmed by calling the real operation with a `provenance`/`version`-bearing response
  through this family's own fake-Grafana harness). `mute-timing.ts` reads both through a small
  local `& { provenance?: string; version?: string }` intersection rather than the SDK's own type.
  The same passthrough applies outbound: `timeIntervals` is typed as an opaque
  `Record<string, unknown>[]`, not the SDK's own too-narrow `TimeInterval` (which is missing the
  real Alertmanager fields — `weekdays`/`times`/`months`/`days_of_month`/`years`/`location` — for
  the same reason), and a real weekday/time entry reaches the wire unchanged. Tracked as a real SDK
  type-generation gap in `docs/upstream-conformance.md` (the S22 fix route) — not a data-loss gap.
- **`version` rides on `destroy`, not `update`** — measured: `RouteDeleteMuteTimingRequest.version`
  exists for optimistic concurrency; `RoutePutMuteTimingRequest` has no `version` field at all, a
  real Grafana API asymmetry between the two write routes.

## `Grafana.MessageTemplate`

```ts
import { GrafanaMessageTemplate, grafanaProviders } from '@homeflare/alchemy/grafana';

export class SlackBody extends GrafanaMessageTemplate('slack-body-template', {
  name: 'slack-body',
  template: '{{ define "slack-body" }}...{{ end }}',
}) {}
```

- **Create and update are the same wire call** — measured: no `routePostTemplate` exists, only
  `routePutTemplate` (`PUT /v1/provisioning/templates/{name}`, upsert by name). Kept as two spec
  functions anyway so the shared engine's `diff` reports a content change as `update`, not the
  `replace` it shows for any resource whose `spec.update` is `undefined` (`resource.ts`).
  `version` rides on `update` when Grafana reports one, for optimistic concurrency.

## Tests

Each resource's `*.test.ts` uses the family's `fake-grafana.ts` harness (the real distilled
protocol, only wire responses faked) and proves: a GET never carries a body; a foreign-provenance
object — an explicit `"file"` OR a MISSING `provenance` field — refuses update/destroy with no write
sent, while an explicit `""` is writable; a transient failure (401/403) propagates rather than
folding to absent; an unchanged declaration is a noop despite Grafana injecting an extra field the
declaration never mentioned; and — `Grafana.ContactPoint` only — a secret value never appears in the
attributes a real `reconcile` returns (driven end to end through create and the read-back
`resource.ts` always does, not just asserted absent from a declaration that never held it).
`Grafana.ContactPoint`'s tests are split three ways (`contact-point.test.ts`/`-secrets.test.ts`/
`-provenance.test.ts`, sharing fixtures from `contact-point-fixtures.ts`) to stay under the house's
250-line file cap.

## Measured vs inferred (no live call in this PR)

**Measured**, against the SDK's generated types and/or Grafana's own docs: the provenance enum and
its values; the absence of a by-uid contact-point GET; the create/update PUT-only shape for
templates and the `version`-on-destroy-only shape for mute timings; the response-decode
verbatim-passthrough behavior (traced into `@distilled.cloud/core`'s own source and confirmed
against the real operation through this family's fake-Grafana harness — as close to "measured" as
this PR gets without a live Grafana instance). **Inferred, not measured live:** whether Grafana's
real server-side provenance enforcement covers every write route this family calls the same way (only
the alert-rule-deletion case is corroborated by a filed issue); whether a genuine mute-timing
`version` conflict on delete surfaces as a typed `Conflict` in practice.

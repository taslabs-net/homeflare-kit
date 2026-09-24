/**
 * The shared refusal for a foreign-provenance ALERTING-PROVISIONING object — `Grafana.ContactPoint`,
 * `Grafana.MessageTemplate`, `Grafana.AlertRuleGroup` and `Grafana.NotificationPolicy` each read a
 * `provenance` string off what Grafana returns (`EmbeddedContactPoint.provenance`,
 * `NotificationTemplate.provenance`, `ProvisionedAlertRule.provenance` per rule, `Route.provenance`
 * on the policy tree — all measured against `@distilled.cloud/grafana`'s generated types,
 * `packages/distilled-grafana/src/services/grafana.ts`) and refuse a write when it disagrees with
 * what this family is allowed to own. Sibling to `provisioned.ts`, not a rename of it — the two
 * refusals guard different fields with different value shapes (`managedBy`/`provisioned` there,
 * `provenance` here) for two different Grafana API surfaces (classic folder/dashboard vs. alerting
 * provisioning), but both end in the SAME tagged error, reused from `provisioned.ts` rather than
 * declared twice: "a write was refused because something else owns this object" is one condition
 * across the whole family, the spirit PR 245's provisioned refusal already established.
 *
 * ★ THE ALLOWLIST, MEASURED AGAINST GRAFANA'S OWN SOURCE (not this SDK, which only echoes the
 *   value back on read — never re-fetched live in this PR): Grafana's `pkg/services/ngalert/
 *   models` package defines a `Provenance` type with `ProvenanceNone = ""` (nothing has claimed
 *   the object — fresh, or written through the classic non-provisioning path), `ProvenanceAPI =
 *   "api"` (created or last written through THIS provisioning API — what this family's own
 *   create/update leaves behind), `ProvenanceFile = "file"` (Grafana's file-based provisioning),
 *   and `ProvenanceConvertedPrometheus = "converted_prometheus"` (the Prometheus-rules importer).
 *   Corroborated by Grafana's own docs (grafana.com/docs/grafana/v13.1/alerting/set-up/
 *   provision-alerting-resources/http-api-provisioning/), whose example payloads show
 *   `"provenance": "api"` on an alert rule this API created and `"provenance": "file"` on a
 *   file-provisioned mute timing and template.
 *
 *   `WRITABLE_PROVENANCES` is therefore an ALLOWLIST of `{"", "api"}`, not a denylist of the two
 *   named foreign values — a provenance source not yet named above (a plugin importer, a future
 *   Grafana release) refuses by default instead of silently being treated as writable, the safer
 *   failure direction for a control-plane write.
 *
 * ⛔ A MISSING `provenance` FIELD IS TREATED AS FOREIGN, NEVER AS `ProvenanceNone` — fixed after an
 *   adversarial review of this PR found the first version failed OPEN: every resource mapped
 *   `live.provenance ?? ''`, and `''` (`ProvenanceNone`, writable) is indistinguishable from a
 *   field the response simply never included once both collapse through `??`. Every `provenance`
 *   field in this family is optional on the wire (`EmbeddedContactPoint.provenance?: string`, etc.
 *   — genuinely absent is a real, typed possibility, not a hypothetical), and `Grafana.MuteTiming`'s
 *   depends on an unmodeled-key passthrough this family has never observed against a real Grafana
 *   response (see its own file header) — a version, edge case or bug in that decode path that drops
 *   the field would, under the old `?? ''` rule, silently make a file-provisioned object look
 *   writable. `isForeignProvenance`/`refuseIfForeignProvenance` below keep `undefined` as its own
 *   value all the way through: ONLY a field Grafana explicitly reported as `""` or `"api"` is
 *   writable; missing entirely refuses, with a message that says so rather than naming a fabricated
 *   provenance value.
 *
 * ⚠️ CLIENT-SIDE DEFENSE, NOT THE ONLY GUARD — AND NOT RE-MEASURED LIVE IN THIS PR. Grafana's own
 *   alerting provisioning API server ALSO enforces this (unlike the classic folder/dashboard write
 *   API `provisioned.ts` guards, which has no such server-side check at all): grafana/grafana#103597
 *   ("Unable to delete file provisioned alert rules") reports exactly this block firing for a
 *   `file`-provenance object, and the `X-Disable-Provenance` header's own documented purpose is "by
 *   default, you cannot edit API-provisioned alerting resources in Grafana" (same doc page). This
 *   function exists anyway, for the same reason `provisioned.ts` does: a clear, typed, house error
 *   instead of whatever 400-with-a-string-message Grafana's server happens to return this version —
 *   and as a defense against the known server-side bug that same issue documents
 *   (`X-Disable-Provenance` failing to actually unlock a `file`-provenance object), which could
 *   otherwise leave a write silently rejected with only a generic `BadRequest` and no explanation
 *   of why.
 *
 * ⚠️ `Grafana.MuteTiming` ALSO USES THIS FUNCTION, BUT THROUGH A WIDENED LIVE TYPE — the SDK's
 *   generated `MuteTimeInterval` interface (the TS type for both `GET .../mute-timings` and
 *   `GET .../mute-timings/{name}`) declares no `provenance` field at all, unlike every other type
 *   named above. A first pass at this family assumed that meant the DATA was gone; it is not —
 *   MEASURED (see mute-timing.ts's own file header for the full account): `@distilled.cloud/core`'s
 *   response decoding never runs a strict schema decode, only `JSON.parse` + a key-rename pass that
 *   passes any key a type doesn't model through verbatim, so `provenance` survives on the actual
 *   runtime value even though the TS type doesn't know about it. `mute-timing.ts` reads it through
 *   a small local `& { provenance?: string }` intersection type rather than the SDK's own.
 */
import * as Effect from 'effect/Effect';
import { GrafanaProvisionedObjectError } from './provisioned.ts';

export { GrafanaProvisionedObjectError };

const WRITABLE_PROVENANCES = new Set(['', 'api']);

/**
 * True when `provenance` names an owner other than "this API" — INCLUDING when Grafana did not
 * report the field at all (`undefined`). `undefined` is deliberately NEVER folded into `''`
 * (`ProvenanceNone`) here — see the file header's "fails open" note. Only a value Grafana
 * explicitly reported as `""` or `"api"` is writable.
 */
export const isForeignProvenance = (provenance: string | undefined): boolean =>
  provenance === undefined || !WRITABLE_PROVENANCES.has(provenance);

export const refuseIfForeignProvenance = (
  kind:
    | 'Grafana.ContactPoint'
    | 'Grafana.MessageTemplate'
    | 'Grafana.MuteTiming'
    | 'Grafana.AlertRuleGroup'
    | 'Grafana.NotificationPolicy',
  id: string,
  provenance: string | undefined,
): Effect.Effect<never, GrafanaProvisionedObjectError> => {
  const reason =
    provenance === undefined
      ? `did not report a provenance at all — this family cannot tell whether it is safe to own`
      : `has provenance '${provenance}', not '(none)' or 'api'`;
  return Effect.fail(
    new GrafanaProvisionedObjectError({
      message:
        `${kind} '${id}' ${reason} — something other than this API may own it (file ` +
        `provisioning, the Prometheus-rules importer, or similar), and writing here could take ` +
        `over or corrupt an object this family does not actually control. Edit it at its actual ` +
        `source instead — declaring this object read-only (a declaration matching what is live) ` +
        `is safe and will never reach this refusal.`,
    }),
  );
};

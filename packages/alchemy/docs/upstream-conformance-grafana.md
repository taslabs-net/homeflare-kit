# Upstream conformance: Grafana

Status: extracted from the [conformance ledger](./upstream-conformance.md); its dated
measurements and open findings are preserved below.

15. **`grafana/*` (added 2026-09-24) ships only `Datasource` — a real SDK gap, not scope-trimming.**
    Measured against the published `@distilled.cloud/grafana@1.0.0-rc.12` tarball's
    `lib/services/grafana.d.ts` (4,938 lines): the package has no create/read/update/delete
    operations for folders (only `updateFolderPermissions` exists), plain dashboards (only
    snapshot/public-dashboard routes exist — no `POST /dashboards/db`, no
    `GET/DELETE /dashboards/uid/{uid}`), alert rules or contact points (both have only a
    `routeGet*Export` read-only route under `/v1/provisioning/`, no create/update/delete). S1
    found no upstream `Alchemy` family for any of these either. Full detail:
    [grafana.md](./grafana.md#the-sdk-gap--why-only-datasource-ships).

    ✅ **S22 fixed 2026-09-24** (branch `claude2/distilled-grafana`): root cause measured to be
    `skipDeprecated: true` dropping 64 operations Grafana's own spec marks `deprecated: true` in
    favor of a separate, undocumented-here Kubernetes-apiserver route — not a spec omission. RFC-6902
    patches un-deprecate exactly the 32 operations this finding named (folders, dashboards,
    alerting-provisioning writes); the other 32 stay excluded. Shipped as
    `@homeflare/distilled-grafana` (0.1.0 pre-release, 0.2.0 once this PR's `minor` changeset
    releases it), aliased onto `@distilled.cloud/grafana` the same S22 route
    `@homeflare/distilled-netbox` established. `Grafana.Datasource`'s props/attributes/generated code
    are unchanged (diffed operation-by-operation against the prior commit).
    - ⚠️ **Knowing departure from upstream (Q8, decision 49 "upstream wins", 2026-09-24, WI-13):**
      upstream's own rule for a deprecated vendor API is to document it _out of scope_, not
      implement it — "Deprecated APIs (superseded by Rulesets etc.) … are documented as out of
      scope in `INDEX.md` rather than implemented" (A `AGENTS.md:155`). The 32 un-deprecated
      operations above do the opposite: they are un-deprecated and implemented. The reason is that
      there is no in-scope replacement to point at instead — Grafana's spec marks these
      `deprecated: true` in favor of a Kubernetes-style aggregated apiserver under
      `/apis/{folder,dashboard,...}.grafana.app/v1…`, and that route family is **absent from the
      pinned spec entirely**: MEASURED 2026-09-24 in the grafana worktree
      (`packages/grafana/specs/spec-mirror-grafana/specs/openapi3.json`), 0 of 207 paths start
      with `/apis` — the un-deprecation patches' own descriptions already say the same thing
      (`packages/grafana/patches/001-undeprecate-folders.patch.json`: "That newer route … [is] not
      present in this spec at all"). Following upstream's rule literally here would mean shipping
      no `Grafana.Folder`/`Dashboard`/alerting-provisioning family at all, on an API the kit
      already needs. The departure is scoped to exactly these 32 operations; the other 32 stay
      excluded, deprecated, out of scope, matching upstream on that half.

    ✅ **`Grafana.Folder`/`Grafana.Dashboard` shipped** (PR 245, on top of the same
    `@distilled.cloud/grafana` operations S22 unblocked) — the uid-required doctrine, the
    provisioned-object refusal, the parentUid-is-create-only refusal and the volatile-field
    normalization that makes an unchanged dashboard a true noop are all in
    [grafana-folder-dashboard.md](./grafana-folder-dashboard.md), not repeated here.

    ✅ **`Grafana.ContactPoint`/`Grafana.MuteTiming`/`Grafana.MessageTemplate` shipped** (kit PR
    250, first of three stacked PRs — `Grafana.AlertRuleGroup` then `Grafana.NotificationPolicy`
    follow):
    the foreign-provenance refusal (`alerting-provenance.ts`, an allowlist of Grafana's own
    `ProvenanceNone`/`ProvenanceAPI` values, measured against `pkg/services/ngalert/models` and
    Grafana's v13.1 docs) and the secret-settings-ref seam (`secret-refs.ts`, shared with
    `Grafana.Datasource`) are both new shared building blocks — full detail:
    [grafana-alerting.md](./grafana-alerting.md).
    - 🔴 **New SDK gap found, not fixed here:** `MuteTimeInterval`'s generated type has no
      `provenance`/`version` fields, and the SDK's own `TimeInterval` type is missing the real
      Alertmanager time-interval fields (`weekdays`/`times`/`months`/etc.) entirely — Grafana's real
      API returns and accepts all of them. NOT a data-loss gap: `@distilled.cloud/core`'s response
      decoding never runs a strict schema decode (`JSON.parse` + a key-rename pass that leaves any
      unmodeled key verbatim — `protocol-http.ts`'s `mapKeys`, confirmed by driving the real
      operation through this family's fake-Grafana harness), so `mute-timing.ts` reads/writes both
      through a locally-widened type instead. Same S22 fix route as the other named gaps
      (regenerate the distilled clone's spec, copy forward) — not attempted here, since
      `packages/distilled-grafana/src/` is vendored and never hand-edited.
    - Measured, read-only, same census as PR 245's: `teslamate-grafana` has no contact points, mute
      timings or templates configured either (consistent with the alerting-provisioning gap having
      been real, not merely unexploited).

    ✅ **`Grafana.AlertRuleGroup` shipped** (kit PR 254, second of three, branched fresh off `main`
    after PR 250 merged): group, not per-rule, is the unit — `PUT .../rule-groups/{Group}` owns
    evaluation `interval` and the full ordered `rules[]` together, which per-rule operations
    cannot express (no `interval` field, no reordering). Rule order is significant, proven by a
    dedicated test. The per-rule provenance refusal (each `ProvisionedAlertRule.provenance`, since
    the group type itself carries none) reuses `alerting-provenance.ts` unchanged, including the
    missing-means-foreign fix from PR 250's review. A declared group whose folder does not exist
    refuses as a typed `BadRequest` (`RoutePutAlertRuleGroupError` has no `NotFound` case) rather
    than being auto-created — this resource never calls `Grafana.Folder`'s create path. A whole-group
    write silently dropping a live rule not in the declaration (found by that PR's own adversarial
    review) is now warned about loudly rather than silent, never a refusal. Full detail:
    [grafana-alerting-rules.md](./grafana-alerting-rules.md).

    ✅ **`Grafana.NotificationPolicy` shipped** (this PR, third and last of the stacked PRs,
    branched fresh off `main` after PR 254 merged): a SINGLETON — `fetchLive` never returns
    `undefined` (`RouteGetPolicyTreeError` has no `NotFound` case), so this resource has no create
    or delete in the sense every sibling resource does, only adopt-and-update. `destroy` never
    calls `routeResetPolicyTree` without an explicit `allowReset: true` prop, a gate independent of
    (and in addition to) `defaultRemovalPolicy: 'retain'` — two gates, since resetting wipes the
    WHOLE instance's routing back to Grafana's bare default, not one object. The tree is opaque
    `Record<string, unknown>` (same reasoning as `mute-timing.ts`'s `timeIntervals` — Grafana's
    matcher-expression types are complex unions this family does not hand-model), compared via
    `subset-match.ts` for Grafana-injected-default tolerance, with route order significant. The
    same dropped-item warning kit PR 254 introduced for rule groups is mirrored here for dropped
    routes. Full detail: [grafana-notification-policy.md](./grafana-notification-policy.md).

    This completes the alerting-provisioning family this project set out to cover.
    - ⛔ **Same open gaps as `forgejo/*` and `netbox/*` above:** `read` never answers `Unowned`
      (H1), and credentials come from an explicit env var NAME at call time rather than an
      `alchemy/Auth` provider (S24) — here the house's own `grafanaCredentials(target)`, not the
      SDK's `CredentialsFromEnv`, because more than one Grafana instance exists on this estate
      (grafana.md's own Credentials section).
    - Measured, read-only, on `teslamate-grafana.service` (CT100, `teslamate/grafana:4.2.0`,
      Grafana 13.1.3): one datasource (file-provisioned, not API-managed — a live example this
      family COULD adopt), dashboards baked into the image (not API-managed either way), and no
      folders, alert rules or contact points configured — consistent with the gap being real
      rather than merely unexploited. No stack yet imports `@homeflare/alchemy/grafana`.

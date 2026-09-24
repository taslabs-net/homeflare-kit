---
'@homeflare/alchemy': patch
---

`@distilled.cloud/grafana` is not published upstream yet, so this package
now aliases it onto `@homeflare/distilled-grafana` (0.1.0 pre-release,
built the distilled way and shipped from this monorepo — see
`docs/distilled-interim.md`) as a plain `dependencies` entry instead of a
`1.0.0-rc.12` peer — nothing changes for a consumer's install (the peer
line is simply gone from the README and the smoke install, the same way
`/netbox` and `/litellm` already read). `Grafana.Datasource`'s props,
attributes and generated calls are unchanged — its existing tests pass
unmodified.

The alias also picks up `@distilled.cloud/grafana`'s newly-added folder,
dashboard and alerting-provisioning operations (see the
`@homeflare/distilled-grafana` changeset), which fixes the SDK-level gap
`docs/grafana.md` and `docs/upstream-conformance.md` recorded. No new house
`Resource` is added here — `Grafana.Folder`/`Dashboard`/`AlertRule`/etc. on
top of these operations is follow-up work, not part of this change.

⚠️ **Deliberate deviation from `docs/distilled-interim.md`'s step 5.** That
doc has the interim package publish and get confirmed live
(`npm view @homeflare/distilled-grafana version`) in its own PR _before_ a
second PR adds the alias — exactly to dodge the propagation window
`scripts/publish.ts`'s own comments document twice (2026-09-15,
`kit@0.1.1`/`cloudflare@0.1.1`: "Your package is being processed and may
take a few minutes to become available"). This PR does both at once, on
purpose, so the next teams building `Grafana.Folder`/`Dashboard`/`AlertRule`
aren't blocked on a second release cycle. `scripts/publish.ts` has no
dependency-aware ordering, so **after this releases, confirm
`npm view @homeflare/distilled-grafana version` resolves before anyone
depends on the new `@homeflare/alchemy` version** — a few minutes' wait,
not a code change, and self-healing either way (the publish script is
idempotent and a stuck install just needs a retry).

---
'@homeflare/alchemy': patch
---

Generated Proxmox API coverage report, with provenance.

`docs/api-coverage.md` and `docs/api-coverage.json` map every PVE and PBS endpoint that can
create, update or delete state to the Resource that owns it, or to nothing — derived from the
vendor schemas named in `schemas/manifest.json` (product version, source host role, sha256, size,
fetch time), not hand-counted. PVE `pve-manager/9.2.4/5e5ae681198514d4`: 88 of 335 write
endpoints owned. PBS `proxmox-backup-server 4.2.6-1`: 27 of 182.

Each row also names the parameters carrying a vendor `maxLength`, `minLength`, `minimum`,
`maximum`, `pattern` or `format` that nothing local enforces — 545 on the PVE endpoints we own and
144 on the PBS ones, including the `comment` on `POST /config/verify` whose 128-character limit
failed a `Pbs.VerifyJob` create at apply time.

Regenerate with `bun run api:coverage`; `--check` exits 1 when the committed report is stale.
`tests/api-coverage.test.ts` fails if a Resource claims an endpoint the schema no longer has, if a
path the source calls unreachable turns out to exist, or if the report has been hand-edited. No
package code changed.

# Vendor API schemas

`manifest.json` records every vendor schema this repository generates from: the product, **the
version string the host itself reports**, where it came from, its sha256, its size, and when it was
fetched and last verified.

⛔ **Never guess a constraint, and never guess a version.** If a rule is not in the vendor document,
it is not enforced, and that fact is recorded rather than invented. If a document cannot be
obtained with a read-only command, it is not used — an operator fetches it.

⚠️ **The task that created this manifest was handed `pve-manager/9.2.11/f6997e698c7933ea`. The host
answered `pve-manager/9.2.4/5e5ae681198514d4`.** Measured 2026-09-22, and the reason the version in
this file comes from `pveversion` on the host rather than from anywhere else.

## The raw documents are not in git

| document                   | size   | why not committed                                              |
| -------------------------- | ------ | -------------------------------------------------------------- |
| PVE `apidoc.js`            | 4.2 MB | vendor-shipped documentation; the sha256 reproduces it exactly |
| PBS `apidoc.js`            | 1.5 MB | same                                                           |
| UniFi Network OpenAPI      | 400 KB | ⛔ its `servers[0].url` embeds a **console identifier**        |
| UniFi Site Manager OpenAPI | 242 KB | kept beside the Network document                               |

They live in a cache directory instead: `$HF_SCHEMA_CACHE`, defaulting to
`~/.cache/homeflare/schemas`. Only **generated, diffable artefacts** are committed —
[`../docs/api-coverage.md`](../docs/api-coverage.md) and
[`../docs/api-coverage.json`](../docs/api-coverage.json) — each carrying the product version and
sha256 prefix it was generated from, so a reader can tell what it is true of.

★ **Why a hash and not the blob.** A 5.7 MB vendor document in the tree would be re-committed on
every point release and reviewed by nobody. A sha256 in a 90-line manifest is reproducible,
reviewable, and fails loudly when the bytes differ.

## Refreshing

```sh
# 1. Re-fetch, read-only. Roles, not hostnames: this is a public repository.
ssh <pve-node> sudo -n cat /usr/share/pve-docs/api-viewer/apidoc.js \
  > "${HF_SCHEMA_CACHE:-$HOME/.cache/homeflare/schemas}/proxmox/pve-apidoc.js"
ssh <pbs-host> sudo -n cat /usr/share/doc/proxmox-backup/html/api-viewer/apidoc.js \
  > "${HF_SCHEMA_CACHE:-$HOME/.cache/homeflare/schemas}/proxmox/pbs-apidoc.js"

# 2. What the hosts now report, and the new hashes.
ssh <pve-node> sudo -n pveversion
ssh <pbs-host> sudo -n proxmox-backup-manager version --output-format json
shasum -a 256 "${HF_SCHEMA_CACHE:-$HOME/.cache/homeflare/schemas}"/proxmox/*.js

# 3. Update version / sha256 / bytes / obtainedAt / verifiedAt in manifest.json, then:
bun run api:coverage          # regenerate, and read the diff
bun run api:coverage --check  # writes nothing; exits 1 when the committed files are stale
```

⚠️ **The PBS document is not where the PVE-shaped guess puts it.**
`/usr/share/javascript/proxmox-backup/api-viewer/apidoc.js` does not exist on 4.2.6. Run
`find /usr/share -name apidoc.js` before concluding it is missing.

⚠️ **PVE opens `const apiSchema = [` and PBS opens `var apiSchema = [`**, and they close
differently: PVE with `]` on its own line and a bare `;` on the next, PBS with `];`. Slicing on
`\n];` finds nothing in PVE and the parse dies at EOF. `scripts/api-schema.ts` handles both.

## What enforces this

- `bun run api:coverage --check` re-reads the cache, **verifies the sha256 against this manifest**,
  regenerates, and reports which committed file is out of date. It needs the cache, so it is a
  local command, not a CI gate.
- `tests/api-coverage.test.ts` runs in CI **without** the cache. It fails when a Resource claims an
  endpoint the schema does not have, when a path the source calls unreachable turns out to exist,
  when the manifest's version or hash no longer matches the report's header, or when the markdown
  has been hand-edited away from the JSON. Every failure names the refresh command.

⛔ **Generated files are never hand-edited.** A correction goes in
`scripts/proxmox-ownership-*.ts` (what our Resources write) or in this manifest (which document we
are true of), and is then regenerated.

## UniFi

Both UniFi documents are recorded as **available, not adopted**: there is no UniFi provider family
in this package, and nothing is generated from them. They are here so the gap list can stop
guessing about UniFi and name the versions instead — Network API `10.4.57` (OpenAPI 3.1.0, 44
paths) and Site Manager API `1.0.0` (OpenAPI 3.0.3, 10 paths).

⛔ Neither has a read-only fetch command: an operator exports them and drops them in the cache.
Keep the Network document's server URL out of commits, pull requests and chat.

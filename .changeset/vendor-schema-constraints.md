---
'@homeflare/alchemy': minor
---

Vendor schema constraints, generated and enforced at plan time. `homeflare-proxmox`'s first
`deploy:pbs` adopted ten objects and then failed its one create on `PVE POST config/verify -> 400:
parameter verification failed - comment: value may only be 128 characters long`. Nothing local
caught it, because the only place the number 128 existed was PBS's published schema: the generated
types keep `type`, `enum` and `optional` and drop every `maxLength`, `minLength`, `minimum`,
`maximum` and `pattern` the vendor states.

A new `codegen/` reads the cluster's own `apidoc.js` and emits machine-readable constraint tables
(`packages/alchemy/src/proxmox/generated/constraints/`, one file per vendor area, all inside the
250-line house cap). `constraints.ts` is a pure validator over a form and its endpoint's table, and
`resource.ts`'s shared `pveHandlers` runs it on both the create form and the update form — so every
family that declares an `endpoint` gets it, with no per-resource copy. `Pbs.Datastore`, which writes
its own handlers, gets the same check through `pbs-datastore-endpoint.ts`. Nineteen families are
wired, covering 37 endpoints: PBS datastore/prune/sync/verify/matchers, PVE acl, groups, roles,
users, backup, firewall aliases, HA resources and rules, matchers, replication, SDN vnets and zones,
pools and storage. Presence of a vendor-required parameter is checked on CREATE only — an update
form is partial by design.

Provenance is committed with it. `codegen/manifest.json` records each schema's vendor, product,
version as the host reports it (pve-manager 9.2.11, proxmox-backup-server 4.2.6-1), source host
ROLE and absolute path, sha256, byte size and fetch time; every generated header names its manifest
entry, version and sha256 prefix. The raw 5.8 MB blobs stay out of git in a documented cache
directory, and the generator refuses to run when a cached file's sha256 does not match.
`tests/schema-manifest.test.ts` recomputes the tables' digest on every run and, when the cache is
present, runs `bun codegen/constraints.ts --check` so a stale generation fails with the exact
refresh command. The two UniFi OpenAPI documents (Network 10.4.57, Site Manager 1.0.0) are recorded
as available and consumed by nothing — there is no UniFi provider family yet.

⛔ Patterns are translated through a whitelist, not copied. Measured over both whole schemas: PBS
prints its Rust regex through `Display`, so every PBS pattern arrives wrapped in slashes, and it
uses POSIX classes — `new RegExp` accepts `/^[[:^cntrl:]]*$/` and `[[:^cntrl:]]` SILENTLY and means
something else in both cases, which would have refused every legal comment. PVE's `(?^:…)` throws.
Anything the whitelist cannot carry over faithfully is recorded verbatim as `patternSource` and left
unenforced, including PVE's 216 server-side `format` validators and PBS `schedule`, which publishes
no pattern at all.

`resource.ts` is split: the `PveSpec` shape and its argument move to `resource-spec.ts` (re-exported,
so no importer changes) to keep both files inside the house cap.

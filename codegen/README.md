# Generating from vendor schemas

Custom providers here are driven by the vendor's own machine-readable schema — never by
hand-written props. A prop typed by hand moves every vendor rule to apply time on the
server, where the declaration fails after the adopts have already landed.

**The incident this exists for, 2026-09-22.** `homeflare-proxmox`'s first `deploy:pbs`
adopted ten objects and then failed its one create:

```
PVE POST config/verify -> 400: parameter verification failed - comment: value may only be 128 characters long
```

`comment` is `maxLength: 128` in PBS's published schema. The generated type said
`comment?: string`. Plan, `bun run check` and `hf-adopt-verify` were all green.

## The rule

1. **Never guess.** A constraint that is not in the vendor schema is not enforced, and
   that fact is recorded rather than invented. `pbs:POST /config/prune`'s `schedule` has
   no pattern and no length — so nothing here checks a schedule.
2. **Always say which version.** Every table header names its manifest entry, the product
   version the host reported, and the sha256 of the bytes that were read.
3. **Never hand-edit a generated file.** `tests/schema-manifest.test.ts` recomputes the
   table's digest; an edited value fails it and names the command below.

## Commands

```sh
bun codegen/constraints.ts           # verify each sha256, regenerate, write
bun codegen/constraints.ts --check   # same, but compare and exit non-zero when stale
```

Both read `codegen/manifest.json`, resolve each schema out of the cache directory it
names, and **stop** when a file's sha256 or byte count does not match. A near-miss is a
different API, not a rounding error.

## The cache, and why the blobs are not in git

`~/.cache/homeflare/schemas/` — override with `HOMEFLARE_SCHEMA_CACHE`.

The two Proxmox schemas are 5.8 MB of vendor-authored JavaScript. Committing them would
put a 4.3 MB file into every clone for data that is reproducible in one command, and it
would make every version bump a 100,000-line diff. **So only the generated, diffable
tables are committed**, and the manifest's sha256 is what makes the raw file
reproducible. A CI runner has no cache, so the staleness check **skips with a message**
there rather than failing.

## Re-fetching, read-only

Both files are world-readable on the host; `sudo -n` is used because the agent lane is
non-interactive.

```sh
mkdir -p ~/.cache/homeflare/schemas/proxmox

# PVE — from a cluster node. Record the version `pveversion` prints.
ssh <pve node> sudo -n cat /usr/share/pve-docs/api-viewer/apidoc.js \
  > ~/.cache/homeflare/schemas/proxmox/pve_<version>_apidoc.js

# PBS — NOT under /usr/share/javascript; `find /usr/share -name apidoc.js` first.
# Record what `proxmox-backup-manager version --verbose` reports.
ssh <pbs host> sudo -n cat /usr/share/doc/proxmox-backup/html/api-viewer/apidoc.js \
  > ~/.cache/homeflare/schemas/proxmox/pbs_<version>_apidoc.js

shasum -a 256 ~/.cache/homeflare/schemas/proxmox/*.js
```

Then update that entry's `version`, `sha256`, `bytes` and `fetchedAt` in the manifest and
run the generator. The diff in `packages/alchemy/src/proxmox/generated/constraints/` is
what changed between the two schema versions.

⛔ **The manifest records a host ROLE, never a hostname or address.** This is a public
repository, and `tests/schema-manifest.test.ts` asserts it.

⚠️ **A mixed-version cluster publishes two different schemas.** Measured 2026-09-22: one
node was still on pve-manager 9.2.4 and shipped a 4,277,440-byte `apidoc.js`, while the
rest were on 9.2.11 with a 4,337,847-byte one. Fetch from a node running the newest
`pve-manager`, or the tables describe an API half the cluster no longer has.

## What the generator does

`apidoc.ts` slices the vendor's `apidoc.js` — PVE opens `const apiSchema = [`, PBS
`var apiSchema = [`, both end with a line that is **exactly** `]` (PVE) or `];` (PBS) and
carry viewer JavaScript after it. ⛔ Slicing on a _trimmed_ `]` cuts at the first nested
array thousands of lines early and yields a plausible, wrong schema.

`constraints.ts` scans `packages/alchemy/src/proxmox/*.ts` (excluding tests) for endpoint
keys — the `'pve:POST /cluster/sdn/zones'` strings a family declares in its `endpoint`
spec field — and tables exactly those. A key naming an endpoint the vendor does not have
**stops the generator**, so a typo is caught here rather than as a runtime "no table for…"
on somebody's deploy. Adding a family therefore means: declare `endpoint`, rerun.

`emit.ts` keeps `type`, `required` (from `optional`), `maxLength`, `minLength`, `minimum`,
`maximum`, `enum`, `pattern`, `format` and `default`. ⛔ It drops **path parameters** —
`{id}` is built into the URL by `spec.path(props)` and never appears as a form key, so
leaving it in would make every create refuse itself for a missing required parameter.

`render.ts` writes one file per vendor area (`pve-cluster.ts`, `pbs-config.ts`) and the
merged `index.ts`, and throws if any of them would exceed the house cap of 250 lines.

## Patterns: the trap worth reading before you touch this

**Neither product ships a JavaScript regex, and copying one verbatim is worse than
dropping it.** Measured 2026-09-22 over both whole schemas — 84 distinct patterns, 18 of
them not JavaScript:

| dialect | example                | what `new RegExp` does with it                                    |
| ------- | ---------------------- | ----------------------------------------------------------------- |
| PBS     | `/^[[:^cntrl:]]*$/`    | **accepts it silently** and matches a literal slash, then a class |
| PBS     | `[[:^cntrl:]]`         | **accepts it silently** as `[[:^cntrl:]` plus a literal `]`       |
| PBS     | `(?P<node>…)`, `(?m)…` | throws                                                            |
| PVE     | `(?^:…)`, `(?^i:…)`    | throws                                                            |

The two PBS cases are the dangerous half: no exception, no hint, and a table built from
them would refuse **every legal comment** at plan time — the opposite of the bug this
exists to catch, and far more damaging.

`pattern.ts` is therefore a **whitelist**: strip Rust's `Display` slashes, lift a leading
`(?m)` to a flag, rewrite `(?P<` and the POSIX classes PBS uses, compile the result — and
drop anything still carrying syntax it does not recognise. A dropped rule is recorded
verbatim as `patternSource` with no `pattern` beside it, and nothing enforces it.

⛔ And PVE **anchors**, which the first generation did not. MEASURED read-only on a node,
`/usr/share/perl5/PVE/JSONSchema.pm:1636`: `if ($value !~ m/^$pattern$/)`. The published
pattern is the inside of an anchored match, `RegExp.test` is a search, and the six PVE
patterns in the tables were all toothless — a firewall alias named `ok name!` matched on
its `ok` and passed. The anchoring is textual, not `(?:…)`, because Perl's is: three of
PVE's 72 patterns have a top-level `|`, and `^a|b$` is not `^(?:a|b)$`. The `\n?` before
the `$` is Perl's `$`, which matches before a final newline where JavaScript's does not.
PBS is left alone: all 37 of its patterns already carry `^…$`.

⛔ `(?^i:…)` is dropped rather than lifted to the `i` flag. The flag is whole-pattern and
the group is not, so lifting it would widen every other branch. `Proxmox.SdnVnet`'s
`alias` is the one that does this; unenforced and honest beats enforced and wrong.

## Which rule kinds are enforced

Measured 2026-09-22 over the 37 tabled endpoints: 525 vendor parameters, 321 of which
carry something worth a row. A green plan means the kinds marked **yes** held — nothing
more.

| Vendor kind          | Rows | Enforced | Why                                                                                 |
| -------------------- | ---: | -------- | ----------------------------------------------------------------------------------- |
| `maxLength`          |   98 | yes      | Characters, not UTF-16 units. The 128 that started this                             |
| `minimum`/`maximum`  |   90 | yes      | Blank and non-numeric values are skipped, never coerced to `0`                      |
| `pattern`            |   62 | yes      | Anchored for PVE; 2 dropped as untranslatable, recorded verbatim                    |
| `enum`               |   45 | yes      | Includes 5 element enums reached through `items`                                    |
| `minLength`          |   41 | yes      |                                                                                     |
| `optional` (absent)  |   31 | creates  | An update form is partial by design, so presence is create-only                     |
| `format` (a name)    |  108 | **no**   | `pve-calendar-event` names a validator PVE publishes nothing about                  |
| `format` (an object) |   10 | **no**   | A property string's packed keys. A rule about `notify` is not one about `notify.gc` |
| `typetext` alone     |  269 | **no**   | A syntax the schema states and does not describe                                    |
| `requires`           |    8 | **no**   | A dependency between parameters, not a value rule                                   |
| `default`            |   55 | n/a      | Recorded so a reader knows what an omitted key means                                |

⛔ The two **no** rows that matter are `format` objects and `typetext`. Together they are
every property string — PBS `notify`, `tuning`, `maintenance-mode`, `backend`, PVE
`bwlimit`, `prune-backups`, `fleecing` — and every `<calendar-event>`. A malformed
schedule or a bad inner key still reaches the server, and this is the honest edge of the
feature rather than an oversight.

★ 30 parameters are arrays and 11 of them state real limits one level down, on `items`.
Those merge into the row and the row says `each: true`, because `violations` checks every
element of a repeated key. `required` is never taken from `items`.

## Coverage today

37 of the vendor's 402 POST/PUT endpoints are tabled — the ones this package writes to.
PVE publishes 258 and PBS 144; the rest are untabled and therefore unchecked at plan
time, which each generated header states in full. That is a gap, not a secret: it shrinks
by one `endpoint` declaration and one regeneration.

Two UniFi OpenAPI documents (Network 10.4.57, Site Manager 1.0.0) are recorded in the
manifest as **available and consumed by nothing** — there is no UniFi provider family
here yet. ⛔ The Network document's server URL embeds a console id, which is an account
identifier; it is not recorded and must not be.

## Not in this repository

The generator that produced `generated/{pve,pbs}.ts` — the _type_ files. Both headers say
`Run: bun codegen/generate.ts` and `git log --all -- 'codegen/*'` was empty before this
directory existed. Nobody can reproduce or correct that mapping without writing it first,
which is why it keeps only `type`, `enum` and `optional` and widens every request
parameter to `string`. Regenerating those types is a separate change with its own diff.

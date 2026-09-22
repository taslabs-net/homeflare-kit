# Generating from NetBox's OpenAPI document

Same rule as [the Proxmox generator](./README.md): never guess, always say which version, never
hand-edit a generated file. What differs is the dialect and where the document came from.

```sh
bun codegen/netbox.ts           # verify the sha256, regenerate tables + coverage, write
bun codegen/netbox.ts --check   # same, but compare and exit non-zero when stale
```

## Where the document came from, and why not from the instance

★ **The canonical source for a NetBox schema is `/api/schema/?format=json` on a running
instance.** That is how the estate's own MCP server imported it, and it is what you should use
when NetBox is up.

⛔ **It was not available.** Measured 2026-09-22: the reference instance restarts every ~95
seconds because its database is unreachable, and has done so since 2026-09-14T17:07Z (3,997
recorded restarts). The application never binds its port, so nothing answers `/api/schema/`.

★ **So the vendor's own published document was used instead, pinned to the release tag** —
`contrib/openapi.json` at `v4.7.0` in `netbox-community/netbox`. NetBox commits this file per
release; it is not a reconstruction.

⚠️ **And it was cross-checked rather than trusted.** The estate holds a snapshot its MCP server
imported from the live instance while it was up. Both sides carry **1256 operations**, and the
two `(method, path)` sets are **identical with zero difference in either direction**.

⛔ **That verifies the PATH surface only.** The estate's snapshot keeps query and path parameters
and discards request bodies entirely — which is exactly the half this generator exists to capture.
Every constraint in the committed tables therefore rests on the vendor document alone, and the
manifest's `note` says so in those words.

## Re-fetching

The document is 14 MB, so it is cached rather than committed — same reasoning as the Proxmox
blobs. From a running instance, preferred:

```sh
mkdir -p ~/.cache/homeflare/schemas/netbox
curl -fsSL -H "Authorization: Token $NETBOX_TOKEN" \
  "$NETBOX_URL/api/schema/?format=json" \
  > ~/.cache/homeflare/schemas/netbox/netbox_<version>_openapi.json
```

From the vendor, when no instance answers — `<sha>` is the blob id in the manifest's
`sourceBlobSha1`, which pins the exact bytes:

```sh
gh api -H "Accept: application/vnd.github.raw" \
  repos/netbox-community/netbox/git/blobs/<sha> \
  > ~/.cache/homeflare/schemas/netbox/netbox_<version>_openapi.json
shasum -a 256 ~/.cache/homeflare/schemas/netbox/*.json
```

⚠️ **`gh api contents/` will not do.** That endpoint caps at 1 MB and returns an empty `content`
field above it — silently, with exit code 0. The blobs endpoint with the raw media type is the one
that works.

Then update `version`, `sha256`, `bytes` and `fetchedAt` in `codegen/manifest.json` and rerun.

## What the generator does

`openapi.ts` normalises the document into the same `VendorEndpoint` shape `apidoc.ts` produces for
Proxmox, so `emit.ts`, the digest and the house cap stay one implementation. Two shapes need care:

- ⛔ **A POST body is `oneOf: [Writable<X>Request, array of the same]`** — the bulk-create form.
  The object branch is selected by shape, not by index. Taking the array branch yields a schema
  with no `properties`, which produces an empty table that looks perfectly generated.
- ⛔ **A nullable foreign key is `oneOf: [{integer}, {allOf: [Brief<X>Request], nullable}]`.** The
  `Brief…` branch carries the RELATED object's rules — a tenant's own `name` length, a VLAN's own
  `vid` bounds — and none of them govern the field in front of you. A union is reduced to its
  scalar type and nothing else.

`netbox.ts` scans `packages/alchemy/src/netbox/*.ts` for `netbox:POST /api/…` keys, exactly as the
Proxmox generator does, and a key naming an endpoint the vendor does not have **stops the
generator**. The same scan supplies the coverage report's owner column, so the report cannot
disagree with the tables.

## Patterns: the trap, measured

⛔ **The dangerous half of this dialect compiles cleanly and means something narrower.** Measured
2026-09-22 over the whole 4.7.0 document — 7 distinct patterns, 2 of them not JavaScript in
meaning:

| pattern       | fields     | Python `re` on a `str`          | JavaScript             |
| ------------- | ---------- | ------------------------------- | ---------------------- |
| `^[-\w]+$`    | `slug`     | `\w` is UNICODE: `ü`, `é`, `中` | `\w` is `[A-Za-z0-9_]` |
| `^[\w.@+-]+$` | `username` | same                            | same                   |

Django ACCEPTS `zürich-core`; a verbatim JavaScript copy REFUSES it. ⚠️ **The `u` flag does not
fix this** — `\w` stays ASCII in JavaScript under `u`; only an explicit `\p{L}` rewrite would
widen it, and rewriting a vendor's character class by hand is the guessing this pipeline forbids.

★ So `py-pattern.ts` is a **whitelist that changes nothing**: a pattern either is already valid,
ASCII-only JavaScript and is kept verbatim, or it is dropped and recorded as `patternSource` with
no `pattern` beside it. Nothing enforces a dropped rule, and the generated header says so.

The other five carry over exactly: `^[-a-zA-Z0-9_]+$`, `^[0-9a-f]{6}$`, `^[a-z0-9_]+$`, `^[^/]+$`
and the DNS-name alternation.

## Coverage

[`docs/netbox-coverage.md`](../docs/netbox-coverage.md), generated by the same command. ⛔ It is a
**separate pipeline** from `docs/api-coverage.md`: that one reads `schemas/manifest.json` under
`HF_SCHEMA_CACHE` and gets its owner column from a hand-written ledger. Unifying the two is its
own change with its own diff, and is recorded rather than papered over.

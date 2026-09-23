# Generating from Paperless-ngx's OpenAPI document

Same rule as [the Proxmox generator](./README.md) and [the NetBox one](./netbox.md): never guess,
always say which version, never hand-edit a generated file. This generator also emits TypeScript
**types** (`codegen/openapi-types.ts`), not only constraint tables — NetBox's Props/Attributes
are hand-typed; Paperless's are not.

```sh
bun codegen/paperless.ts           # verify the sha256, regenerate tables + types + coverage
bun codegen/paperless.ts --check   # same, but compare and exit non-zero when stale
```

## Where the document came from

★ **The served document, read with no credential.** `paperless-ngx`'s repository commits no
OpenAPI document at any tag — a tree search at `v3.1.1` finds only `src/documents/schema.py` and
its own test, never a checked-in `openapi.json`. Unlike NetBox, the running instance answered:

```
curl -s 'http://127.0.0.1:28981/api/schema/?format=json'  ->  200, application/vnd.oai.openapi
```

722,398 bytes, sha256 `d0fe550d2135e37b6846ec96ddafcf18395a5c9e433075d217745c35e1d8a830`, stable
across two fetches, measured 2026-09-23T13:31:56Z.

⛔ **The version is NOT `info.version`.** drf-spectacular's `SPECTACULAR_SETTINGS['VERSION']` is
set to the literal string `'6.0.0'` (unrelated to the application release) and the document's
`info.version` reads `"6.0.0 (10)"` — the `(10)` is the DRF `AcceptHeaderVersioning` default, not
a Paperless-ngx release number. The real version is `src/paperless/version.py`'s `(3, 1, 1)`,
read from the host's own Nix-built copy.

★ **Provenance rests on the installed source being byte-identical to the tag**, since no document
is committed there. `git hash-object` of the installed `version.py`, `urls.py`,
`documents/serialisers.py` and `paperless/settings/__init__.py` all matched the `v3.1.1` tag's
blobs. `urls.py`'s match cross-checks the served document's PATH surface against the tag's router
registrations — the same shape as NetBox's cross-check, and the same limit: it says nothing about
request bodies, which rest on the served document alone.

## The dialect

Paperless-ngx is Django/DRF, exactly like NetBox: `codegen/dialects.ts` tables both as
`translateDjangoPattern`, no anchoring (Django's `RegexValidator` runs `re.search`, and both
vendors' own patterns already carry `^…$`). See `codegen/py-pattern.ts` for the measured Unicode
`\w` trap this shares with NetBox.

## What gets tabled

Every write endpoint this package's four Resources declare — `tags`, `document_types`,
`storage_paths`, `custom_fields` — found by scanning `packages/alchemy/src/paperless/*.ts`
(providers only, never a test) for `'paperless:POST …'`-style keys, the same scan `netbox.ts`
runs. A key the vendor does not have stops the generator.

⛔ `set_permissions` (writeOnly, on every taxonomy `*Request`) is never modelled — this slice does
not write permissions.

## Re-fetching, read-only

```sh
mkdir -p ~/.cache/homeflare/schemas/paperless
curl -fsS 'http://127.0.0.1:28981/api/schema/?format=json' \
  > ~/.cache/homeflare/schemas/paperless/paperless_<version>_openapi.json
shasum -a 256 ~/.cache/homeflare/schemas/paperless/*.json
```

Take the version from `version.py` on the host running the service (`(3, 1, 1)` style), never
from the document's own `info.version`. Then update `version`, `sha256`, `bytes` and `fetchedAt`
in the `paperless-openapi` entry of `codegen/manifest.json` and rerun.

⛔ **The manifest records a host ROLE, never a hostname or address.** This is a public repository;
`tests/paperless-manifest.test.ts` asserts it.

## What `codegen/openapi-types.ts` does

One TypeScript module per family — `generated/types/tags.ts`, `document-types.ts`,
`storage-paths.ts`, `custom-fields.ts` — each an interface pair (`Paperless{Name}Request`,
`Paperless{Name}`) built by walking the write endpoint's request-body and 201-response component
schemas directly (not through `emit.ts`'s flattened `VendorParam`, which is lossy on purpose for
the constraint tables). It keeps integer and string types, renders every enum as a TypeScript
literal union (`MatchingAlgorithm`'s `0 | 1 | … | 6`, `DataTypeEnum`'s ten string values),
appends `| null` for a nullable property, and drops a `readOnly` field from the request type and
a `writeOnly` one from both. A shape it cannot resolve faithfully — a `$ref` this document does
not carry, a multi-branch `allOf` — throws rather than falling back to `unknown` silently.

Each module throws if it would exceed the house's 250-line cap; splitting further by area is the
same `bun codegen/paperless.ts` run away as adding a family.

## What is recorded but not enforced

- `matching_algorithm`'s outer `minimum: 0, maximum: 32767` override is lost to the same
  single-branch-`allOf` resolution `openapi.ts` uses for NetBox's nullable foreign keys — the
  enum `[0..6]` survives, the wider numeric bound does not. Unenforced and honest.
- `CustomField.select_options` (the serializer's own rule for a `select` field's option list) is
  not in the served schema at all.
- Every `format` name (a DRF validator run server-side) and a pattern `codegen/py-pattern.ts`
  could not carry over faithfully (recorded verbatim as `patternSource`).

## Coverage

See the generated [`docs/paperless-coverage.md`](../docs/paperless-coverage.md) for the exact
counts against this run's schema — this file states the method, not the numbers, which drift
with every regeneration.

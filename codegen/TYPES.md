# Generating the Proxmox API types

`packages/alchemy/src/proxmox/generated/{pve,pbs}.ts` and the `{pve,pbs}/` directories
beside them. Read `codegen/README.md` first: the manifest, the sha256-as-identity rule and
the read-only re-fetch recipe are shared with the constraint tables and are not repeated
here.

```sh
bun codegen/types.ts           # verify each sha256, regenerate, write
bun codegen/types.ts --check   # compare without writing; exit 1 on a stale or orphaned file
```

## The hole this fills

Measured 2026-09-22. The committed type files carried the header `Run: bun codegen/generate.ts`
from the day they landed, and:

```sh
git log --oneline --all -- 'codegen/generate*'   # no output, at any commit
```

So the mapping existed only as its own 8,196 lines of output. Nobody could reproduce it,
correct it, or say which schema version it described — and because nobody could read it,
nobody noticed what it did:

| kept                       | dropped                                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `type`, `enum`, `optional` | `maxLength`, `minLength`, `minimum`, `maximum`, `pattern`, `format`, `typetext`, `default`, every description |

and, worse than dropping, **widening**: every integer or number request parameter became
`string`. `pbs:POST /config/verify`'s `max-depth` is `integer, minimum 0, maximum 7` in the
schema and was `'max-depth'?: string` in the type, which accepts `'banana'`.

Coverage was partial and unexplained: 407 of PVE's 678 endpoints and 46 of PBS's 367, with
no record of which 407 or why. `GET /cluster` was missing; `GET /cluster/replication` was
present.

## What it does now

Every endpoint in both schemas — 678 PVE and 367 PBS, 1,617 exported types. Not a subset,
because a subset is a decision, and a decision nobody wrote down is the defect above.

### The request side is text, and that is measured, not assumed

`client.ts` sends `application/x-www-form-urlencoded` and types the body
`PveForm = Record<string, readonly string[] | string>`. `constraints.ts` says in as many
words that "the form is strings by construction", and `violations` iterates a value as
either a string or an array of them. So:

| vendor says          | the type is       | why                                                                                   |
| -------------------- | ----------------- | ------------------------------------------------------------------------------------- |
| `integer` / `number` | `` `${number}` `` | still a string, so it still satisfies `PveForm` — but `'banana'` no longer typechecks |
| `boolean`            | `'0' \| '1'`      | the encoding `values.ts`'s `flag()` produces                                          |
| `enum`               | the literal union | unchanged                                                                             |
| `array`              | `readonly T[]`    | repeated keys on the wire, not a JSON list                                            |

⛔ **`number` would have been wrong, not braver.** A `number` cannot be handed to `pve()`
at all, and widening `PveForm` to accept one would mean changing `violations` in
`constraints.ts`, which iterates on `typeof value === 'string'` and would crash on a number.

⚠️ **`String(n)` will not typecheck against `` `${number}` ``** — `String` returns a plain
`string`. Write `` `${n}` ``. That is the one ergonomic cost and it is the point: the
template literal is what carries the numeric-ness across.

⚠️ **`` `${number}` `` admits `'1.5'` where the schema says integer.** TypeScript has no
integer-valued string type that a `` `${n}` `` template still satisfies — `` `${bigint}` ``
refuses one. Integrality and the bounds stay where they are already **enforced**: the
generated constraint tables, checked at plan time by `constraint-guard.ts`.

### The response side is JSON and is not spelled for the wire

`number` is `number`, and a boolean is `boolean | 0 | 1` because PVE's Perl sends both
depending on the endpoint's serialiser — which is why `values.ts`'s `bool` accepts the
union.

⛔ **"Closed object" is spelled differently by the two products.** Measured over both whole
schemas: PVE writes numbers (`additionalProperties: 0` on 617 objects, `1` on 21, absent on
352 — Perl's JSON encoder), PBS writes booleans (`false` on 560, `true` on 36 — serde). A
test for `!== 0` alone marks all 560 of PBS's closed objects open. An **absent**
`additionalProperties` is open: the vendor did not promise the list is exhaustive.

## The old output is reproduced before it is changed

`tests/schema-type-mapping.test.ts` pins the mapping against shapes lifted from the
committed files rather than against a snapshot of the generator. Run against the same two
schemas with integers left widened, the pipeline re-emits all 646 PVE and 69 PBS
declarations identically, with two recorded exceptions:

1. `NodesNodeLxcVmidConfigGetReturn`'s `lxc` was `readonly string[][]` — readonly outside,
   mutable inside. It is now `readonly (readonly string[])[]`. Nothing mutates a response.
2. 21 declarations are laid out differently: `oxfmt` had reformatted the committed files
   before every `generated` directory reached its ignore list, breaking inside
   `Record<string, unknown>` where this generator breaks the object. Same type, different
   line breaks.

The naming is the old generator's, reproduced rather than improved: segments split on `-`
and `.` but **not** `_`, so `/cluster/backup/{id}/included_volumes` is still
`ClusterBackupIdIncluded_volumesGetReturn`. Renaming ~60 exported types in the same commit
that changes what the types mean would hide the second change inside the first.

## Splitting, and the eight files that cannot meet the cap

`codegen/types-split.ts` groups by the vendor's own path, deepening only where a file would
exceed the house cap of 250 lines, then packs neighbours back together so the split is no
deeper than the cap requires. 89 files; median 213 lines.

`generated/pve.ts` and `generated/pbs.ts` stay as **barrels** of `export *`, so no consumer
moves. ⚠️ That is right here and wrong in `src/proxmox/index.ts`, which is deliberately
smaller than its directory; this barrel's whole job is to publish everything.

⛔ **Eight PVE files are over the cap and cannot be split.** Each holds the endpoints of one
vendor path whose parameters carry enums of hundreds of members — `rootfs`, `mp0`…`mp255`,
`unused0`…`unused255` for the volume moves; the ACME DNS provider list; the QEMU CPU model
list. A single type declaration is the smallest unit there is. Dropping the enum would widen
the parameter back to `string`, which is the defect this generator exists to remove, and
re-flowing it to fill 100 columns makes one added mount point rewrite forty lines. Each file
says so in its own header and `tests/schema-types.test.ts` pins the list — a ninth is a real
change, not a formality.

## Never hand-edit the output

`bun codegen/types.ts --check` regenerates into memory and fails on any file that differs or
that the generator no longer produces. `tests/schema-types.test.ts` runs it when the schema
cache is present and **skips with the refresh command** when it is not, because CI has no
cache.

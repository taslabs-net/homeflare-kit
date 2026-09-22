---
'@homeflare/alchemy': minor
---

The Proxmox API type generator, written from the vendor schemas, and the widening it removes.
`packages/alchemy/src/proxmox/generated/{pve,pbs}.ts` carried the header
`Run: bun codegen/generate.ts` from the day they were committed, and
`git log --oneline --all -- 'codegen/generate*'` is empty at every commit: that file existed
nowhere. The mapping was therefore readable only as its own 8,196 lines of output — nobody could
reproduce it, correct it, or say which schema version it described. Because nobody could read it,
nobody noticed what it did: it kept `type`, `enum` and `optional`, dropped every `maxLength`,
`minLength`, `minimum`, `maximum`, `pattern`, `format`, `typetext`, `default` and description, and
covered 407 of PVE's 678 endpoints and 46 of PBS's 367 with no record of which 407 or why.

`bun codegen/types.ts` is that generator, with `--check`, the same manifest and the same
sha256-as-identity rule as `codegen/constraints.ts`. It emits every endpoint both products
document — 678 PVE and 367 PBS, 1,617 exported types — split across 89 files by the vendor's own
path and packed back up so the split is no deeper than the 250-line house cap requires. Every file
names its manifest entry, the product version the host reported and the sha256 of the bytes it was
read from. `generated/pve.ts` and `generated/pbs.ts` stay as `export *` barrels, so no import in
this package or any consumer moves.

⛔ **An integer request parameter is `` `${number}` ``, not `string`.** `pbs:POST /config/verify`'s
`max-depth` is `integer, minimum 0, maximum 7` in PBS's schema and was `'max-depth'?: string` in
the type, which accepts `'banana'`; 480 PVE and 151 PBS parameters were widened that way. They are
now the wire spelling of a number: still assignable to `PveForm`, still carried unchanged through
`violations`' bound check, and no longer satisfied by an arbitrary string. It is deliberately NOT
`number`: `client.ts` sends `application/x-www-form-urlencoded` and types the body
`Record<string, readonly string[] | string>`, so a `number` could not be handed to `pve()` at all,
and `constraints.ts` iterates a form value on `typeof value === 'string'`. ⚠️ `String(n)` does not
typecheck against it — write `` `${n}` ``. A boolean parameter stays `'0' | '1'`, which is the
encoding `values.ts`'s `flag()` already produces rather than a widening. Responses are JSON and
keep their real `number` and `boolean | 0 | 1`.

The old output is reproduced before it is changed, which is what makes the diff reviewable: run
against the same two schemas with integers left widened, the pipeline re-emits all 646 PVE and 69
PBS declarations identically, with two recorded exceptions — `NodesNodeLxcVmidConfigGetReturn`'s
`lxc` becomes `readonly (readonly string[])[]` rather than a readonly array of mutable ones, and 21
declarations break lines differently because `oxfmt` had reformatted the committed files before
every `generated` directory reached its ignore list. The naming is the old generator's, reproduced
rather than improved: `ClusterBackupIdIncluded_volumesGetReturn` keeps its underscore, because
renaming sixty exported types in the commit that changes what the types mean would hide the second
change inside the first.

⛔ "Closed object" is spelled differently by the two products, and a test for one lies about the
other. Measured over both whole schemas: PVE writes numbers (`additionalProperties: 0` on 617
objects, `1` on 21, absent on 352), PBS writes booleans (`false` on 560, `true` on 36). An absent
`additionalProperties` is open — the vendor never promised the list was exhaustive.

⛔ Eight PVE files are over the house cap and cannot be split. Each holds the endpoints of one
vendor path whose parameters carry enums of hundreds of members — `rootfs`, `mp0`…`mp255`,
`unused0`…`unused255` for the volume moves, the ACME DNS provider list, the QEMU CPU model list. A
single type declaration is the smallest unit there is; dropping the enum would widen the parameter
back to `string`. Each says so in its own header and `tests/schema-types.test.ts` pins the list.

`tests/schema-type-mapping.test.ts` holds the mapping to shapes lifted from the committed files and
needs no schema cache, so it runs on CI. `tests/schema-types.test.ts` checks provenance, the
barrel against the files on disk, the cap, the coverage counts and five endpoints the old generator
omitted, and runs `bun codegen/types.ts --check` when the cache is present — skipping with the
refresh command when it is not. `codegen/TYPES.md` carries the reasoning.

# Paperless — `@homeflare/alchemy/paperless`

Four resources — `Paperless.Tag`, `Paperless.DocumentType`, `Paperless.StoragePath`,
`Paperless.CustomField` — the taxonomy Paperless-ngx writes through Django's internal models,
create-or-update and never deleted by default. Workflows and mail accounts are a later slice.

## Credentials

Two environment variables, read **at call time**, never props:

| variable          | holds                                                     |
| ----------------- | --------------------------------------------------------- |
| `PAPERLESS_URL`   | the instance origin, e.g. `https://paperless.example.com` |
| `PAPERLESS_TOKEN` | a scoped Paperless-ngx API token                          |

⛔ **Neither has a default.** A package that fell back to a loopback address would let a consumer
who forgot the variable watch every call fail against a machine that is not theirs.

⚠️ **`Authorization: Token <value>`, not `Bearer`** — Paperless-ngx's own `securitySchemes`
states the "Token" prefix explicitly.

⚠️ **Every call carries `Accept: application/json; version=10`**, pinned to the API version this
family was walked against (`REST_FRAMEWORK.DEFAULT_VERSION` at v3.1.1). An estate upgrade that
moves the default cannot silently change what this package receives without that assertion
failing first.

## Every create carries `owner`, null when undeclared

🔴 **This is the one behaviour that had to be measured, not guessed.**
`OwnedObjectSerializer.create` (Paperless-ngx `documents/serialisers.py:495-502` at v3.1.1) sets
the owner to the TOKEN USER whenever the field is absent from the body. Omitting an undeclared
prop the way you might expect — `Netbox.Prefix`'s pattern for an undeclared foreign key — would
silently create an object owned by whichever credential ran the deploy: invisible to every other
user, and a second row beside the estate's `owner: null` one on the next apply. So `Tag`,
`DocumentType` and `StoragePath` always send `owner: null` unless `owner` is declared.

⛔ `Paperless.CustomField` has **no owner field at all** — its wire body is exactly `{name,
data_type, extra_data}`, measured against the schema. It is not `OwnedObjectSerializer`-based.

## Adopt is never silent (H1)

★ **`read` answers `Unowned(attrs)` on every match**, never plain attributes. Paperless has no
ownership marker this package can check — `owner` is the estate's own prop, not proof of who
created a row — so, per the house's 2026-09-21 decision, identical is not ours. `--adopt` (or
`.pipe(adopt(true))`) is required to bind an existing tag, document type, storage path or custom
field, the same posture as any other marker-less API.

## `CustomField.dataType` is create-only

⛔ **A change is refused at plan time, never a PATCH and never a replace.** Changing a custom
field's data type in Paperless deletes that field's value on every document that carries it — a
replace (delete + recreate) is exactly as destructive as a PATCH would be, just under a different
name. Declaring a different `dataType` against a live object fails the plan with both values
named; retire the old field and create a new one instead.

⚠️ The reconciler this family replaces asserted "Paperless forbids a data_type change" — that
claim is **unverified** at v3.1.1 (`CustomFieldSerializer.validate` and `CustomFieldViewSet`
contain no such refusal). This package refuses the change regardless, because the destructive
side effect is real whether or not the vendor also refuses it.

## Removal is `retain`

Every family defaults to `retain` — a tag, document type, storage path or custom field id is
referenced by every document that carries it, and Paperless does not offer a "detach first"
option. `delete` is fully implemented; dropping a declaration does not delete the object unless
the caller opts into `.pipe(RemovalPolicy.destroy())`.

## Locate is `name__iexact`, identity is exact `(name, owner)`

`MatchingModel` (Paperless-ngx `models.py:79-89`) has `UniqueConstraint(name, owner)` plus a
unique name where owner is null. `matching.ts` locates candidates with a case-insensitive filter
— wide enough to see every case-variant Paperless holds — and then narrows to the exact-case,
exact-owner row in this process, the same locate-then-identify split `Netbox.Prefix` uses for its
VRF. A locate that matches more than the 20-row page it reads is refused as "not a natural key".

## Generated, not hand-typed

`generated/types/*.ts` and `generated/constraints/*.ts` come from `bun codegen/paperless.ts`
against Paperless-ngx 3.1.1's own served OpenAPI document — see
[`codegen/paperless.md`](../../../codegen/paperless.md) for the full provenance chain. A prop's
enum-shaped fields (`matchingAlgorithm`, `dataType`) are typed by indexing into the generated
request interface (`PaperlessTagRequest['matching_algorithm']`), never retyped by hand.

## Usage

```ts
import { paperlessProviders, Tag } from '@homeflare/alchemy/paperless';
import * as FetchHttpClient from 'effect/unstable/http/FetchHttpClient';

// PAPERLESS_URL and PAPERLESS_TOKEN in the deploy's environment.
export default async () => {
  const app = await alchemy('paperless-taxonomy');
  const invoices = await Tag('invoices', { name: 'Invoices', color: '#a6cee3' });
  await app.finalize();
};
// wire the stack: Layer.mergeAll(paperlessProviders(), …).pipe(Layer.provide(FetchHttpClient.layer))
```

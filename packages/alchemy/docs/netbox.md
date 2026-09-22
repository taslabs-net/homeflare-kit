# NetBox — `@homeflare/alchemy/netbox`

NetBox is a record of decisions, not a controller. Nothing here reboots anything; the worst a
mistake does is write the wrong intent into the source of truth everything else is checked against.
That shapes every posture below.

## Credentials

Two environment variables, read **at call time**, never props:

| variable       | holds                                                  |
| -------------- | ------------------------------------------------------ |
| `NETBOX_URL`   | the instance origin, e.g. `https://netbox.example.com` |
| `NETBOX_TOKEN` | a scoped NetBox API token                              |

⛔ **Neither has a default.** A package that fell back to a loopback address would let a consumer
who forgot the variable watch every call fail against a machine that is not theirs, instead of
being told which variable is missing.

⚠️ **`Authorization: Token <value>`, not `Bearer`.** NetBox is Django REST Framework using DRF's
own `TokenAuthentication`. Measured: `Bearer` returns 401 and `Token` returns 200 — and a wrong
scheme and a wrong credential are indistinguishable in the response.

⛔ **Mint a short-lived, scoped token.** A NetBox token can be given an expiry, a source-IP
restriction and `write_enabled: false`; a plan-only run wants the last of those.

## Adopt is the default posture

`reconcile` LOCATES before it writes. An object the instance already holds is bound, not
duplicated — NetBox predates this code by years on any real estate, and a provider that created a
second `10.0.0.0/24` on first deploy would be worse than no provider.

⛔ **An ambiguous identity FAILS.** `soleMatch` refuses more than one candidate rather than taking
the first: binding to "whichever NetBox ordered first" would make the next plan bind to the other
row and report drift that is not there.

★ **Narrowing is split: a filter the schema declares, then a rule in this process.** `locate`
sends only filters the vendor document states; `identifies` picks the one row among the candidates.

⚠️ **`Netbox.Prefix` uses that split for the VRF, and the reason is a guess that was caught.** A
prefix is unique per-VRF, so the CIDR alone can match several rows. The obvious server-side
narrowing is `vrf_id=null` for the global table — NetBox does define `FILTERS_NULL_CHOICE_VALUE =
'null'`. ⛔ But measured in the vendor's own source at v4.7.0, `PrefixFilterSet.vrf_id` is a plain
`ModelMultipleChoiceFilter` with no `null_value`: it does not opt in, so `'null'` fails queryset
validation and NetBox answers **400 on every plan for every global prefix**. The VRF is compared
here instead, where the rule is readable and testable without a server.

## Removal is `retain`

⛔ **Deleting a NetBox row deletes history.** Child prefixes reparent, IP assignments detach, and
the change log is the only trace left. Every family here defaults to `retain`, so dropping a
declaration does not delete the object unless the caller opts into `.pipe(RemovalPolicy.destroy())`.
The `delete` handler is fully implemented anyway — a stub that silently does nothing lies to
whoever reads the plan.

## An undeclared field is not an instruction to clear it

🔴 **This shipped wrong once, and the shape of the mistake is worth keeping.** `Netbox.Prefix`
sent `description: ''` whenever the prop was absent. On a create that is invisible — the field was
empty anyway. ⛔ **On an adopt it is data loss**: a prefix's description is usually the only written
trace of why that range exists, and the first deploy that adopted one would have PATCHed it to
empty, with a plan that read `update`.

★ **So the line is drawn at what the vendor itself defaults.** `status`, `is_pool` and
`mark_utilized` have defaults in the schema, so omitting one genuinely means "the default" and
settling it says what NetBox would have done anyway. `description`, `comments` and every optional
foreign key have no such default — the schema's `''` is the absence of a value, not a decision —
so they are **omitted from the body and uncompared** until you declare them.

⚠️ **The cost, stated:** prose cannot be cleared by omission. Clearing it is `description: ''`,
written on purpose, which is the readable way to say a destructive thing.

⛔ **Whatever `matches` compares, `body` must send.** A field compared but never written produces
a plan that says `update` forever: the PATCH omits it, so the next read is unchanged. The two move
together, and `prefix-form.test.ts` asserts it.

## Read and write are different shapes

⛔ **This is the bug that makes a resource never converge, and it is handled in `values.ts`.** A
prefix is WRITTEN with `status: "active"` and READ BACK as `{value: "active", label: "Active"}`; a
foreign key is written as `4` and read back as `{id: 4, url: …, display: …}`. A `matches` that
compared those directly would report drift on every plan, for every object, forever — and each
"update" would PATCH the same value back.

## Vendor constraints, checked before the request

Every write is checked against a table **generated from NetBox's own OpenAPI document** — not from
hand-typed limits. A declaration the vendor would reject dies at plan time with the endpoint named,
rather than half-way through a deploy that has already adopted ten objects.

```ts
import { bodyViolations, constraintsFor } from '@homeflare/alchemy/netbox';

constraintsFor('netbox:POST /api/ipam/prefixes/')['description']?.maxLength; // 200
```

⚠️ **What it deliberately does NOT enforce**, so a green plan is not read as more than it is: a
`format` name DRF validates server-side; a pattern whose Python `\w` is Unicode where JavaScript's
is ASCII (recorded as `patternSource` with no `pattern`); and uniqueness, VRF containment and
custom-field validators, which live in Django rather than in the schema and still arrive as a 400.

Provenance, the re-fetch recipe and the coverage report: [`codegen/netbox.md`](../../../codegen/netbox.md)
and [`docs/netbox-coverage.md`](../../../docs/netbox-coverage.md).

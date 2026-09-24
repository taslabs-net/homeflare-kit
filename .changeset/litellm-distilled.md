---
'@homeflare/alchemy': patch
---

The `litellm/*` family (`LiteLLM.PassThroughEndpoint`) now calls `@distilled.cloud/litellm`'s
typed `misc` operations instead of a hand-rolled `Effect HttpClient` client. The old
status-carrying `LitellmBadRequestError`/`LitellmUnauthorizedError`/`LitellmHttpError`/
`LitellmTransportError` are gone: every failure the SDK's four operations declare (`BadRequest`,
`NotFound` on update, `UnprocessableEntity`, plus the shared default HTTP errors) is the SDK's own
typed error, `catchTag`'d. `deletePassThroughEndpoint`'s re-list-on-ambiguous-delete trick is
unchanged, now keyed on the `BadRequest` tag instead of a status code. The per-base-URL write
semaphore LiteLLM's whole-list storage forces is unchanged, moved into the new `operations.ts`.
`client.ts` and the kit's own hand-generated `generated/pass-through.ts` are both deleted — the
SDK's `misc.PassThroughGenericEndpoint` is the same shape, generated from the same LiteLLM 1.100.0
OpenAPI document. The `codegen/litellm.ts` generator and `tests/litellm-manifest.test.ts` that
kept that file current are retired with it; the `litellm-openapi` manifest entry stays, recorded
as consumed by nothing, the same pattern the two UniFi entries already establish.

Not published upstream yet, so aliased onto `@homeflare/distilled-litellm@0.2.0` as a plain
`dependencies` entry, not a peer — see `docs/distilled-interim.md`. Credentials still resolve
from `LITELLM_PROXY_URL` / `LITELLM_PROXY_API_KEY` at call time, now through the package's own
`CredentialsFromEnv` layer. Props and attributes are unchanged — an adopted pass-through endpoint
still plans noop.

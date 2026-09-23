---
'@homeflare/alchemy': minor
---

Add `LiteLLM.PassThroughEndpoint` to `@homeflare/alchemy/litellm`, the kit's first LiteLLM
resource: one row of LiteLLM's `/config/pass_through_endpoint` family, a route on the proxy that
forwards requests to an upstream target. Types are generated from LiteLLM **1.100.0**'s own
OpenAPI document (tag `v1.100.0`, commit `e4f25265704e2b2c6cf6e81be2e4c5cffff896f4`), dumped the
way the vendor's own CI dumps it — `prisma generate` against `litellm/proxy/schema.prisma`, then
the `dumpSpec` program embedded in `ui/litellm-dashboard/scripts/gen-api-types.mjs`, run with
`app.routes`' `include_in_schema` forced `True` the way the dashboard's generator does — because
the reference proxy's `/openapi.json` could not be reached when this was walked (jetsam restart
loop). Cross-checked byte-identically: regenerating with `openapi-typescript@7.13.0` reproduces
the tag's committed `ui/litellm-dashboard/src/lib/http/schema.d.ts` exactly, sha256
`8bc5d9c9…40b83f9`, 2,334,248 bytes on both sides. The dump itself is sha256
`1b3e4d23…4b006399f` (`codegen/manifest.json`'s `litellm-openapi` entry).

Every pass-through endpoint lives in one `general_settings.pass_through_endpoints` field — every
create, update and delete is a read-modify-write of the whole list — so every mutating call is
wrapped in a per-base-URL `Effect` semaphore, and `reconcile` reads back after writing rather
than trusting the call that just returned. A path already held by a `config.yaml` entry
(`is_from_config: true`) is refused at plan rather than silently overridden; a foreign DB row on
the same path is `Unowned` and needs `--adopt`; a literal secret in a forwarded `Authorization`,
`x-api-key` or `cf-aig-authorization` header is refused unless it carries LiteLLM's own
`os.environ/NAME` reference form. Clearing `timeout`, `methods` or `guardrails` is planned as a
replace (delete then create), because LiteLLM's update route merges with `exclude_none` and can
never clear an already-set field. Credentials (`LITELLM_PROXY_URL`, `LITELLM_PROXY_API_KEY` —
LiteLLM's own variable names) are read fresh from the environment on every call, never a prop.

Deferred: the Claude OAuth model, key and team slice, which needs estate answers only Tim can
give. See `docs/litellm.md`.

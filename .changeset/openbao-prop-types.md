---
'@homeflare/alchemy': minor
---

Forward every `Bao.*` family's `Props` and `Attributes` types from `@homeflare/alchemy/openbao`.

Each family already re-exported its own types from its module, but the barrel forwarded only the
VALUES for seven of them — `BaoAuthMethod`, `BaoCloudflareRole`, `BaoMount`, `BaoPkiRole`,
`BaoPolicy`, `BaoProxmoxRole` and `BaoSshRole` — plus `BaoAuthRoleAttributes`,
`BaoPluginAttributes`, `BaoJwtRoleAttributes` and `BaoJwtCallbackMode`.

⛔ This is a bug only a consumer could see, and only one that obeys the rules. A stack may use
Resources the package entry exports and must not deep-import, so it could be handed
`BaoProxmoxRole` and still be unable to name its props — leaving it to write the shape out and
hope it stayed in step. MEASURED 2026-09-22 in homeflare-openbao, which did exactly that for
`BaoProxmoxRole` while declaring the VPS proxmox engine. For that family the cost is highest:
`mount` + `name` + `mintUser` + `ttl` + `maxTtl` IS the whole role, so a hand-written copy
duplicates the entire server-side state of a family whose `mintUser` is its security boundary.

Additive and type-only: no value, signature or runtime behaviour changes, and nothing that was
importable stops being importable. `src/openbao/index-types.test.ts` pins the surface with a
type-only test — `tsc --noEmit` is the assertion, so a family whose props stop being reachable
from the package entry fails here instead of in another repo's next consumer.

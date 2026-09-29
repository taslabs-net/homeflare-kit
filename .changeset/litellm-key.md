---
'@homeflare/alchemy': minor
---

Add `LiteLLM.Key`, a LiteLLM virtual key that binds to a `LiteLLM.Budget` tier. It is found by its alias, so an existing key is adopted without holding its value, and it defaults to `retain` on removal. The key value is write-only: `key: { fromEnv: 'NAME' }` names the environment variable, the value goes to `/key/generate` once and is never a prop, an attribute, or in an error. It refuses a create while `DISTILLED_DEBUG_HTTP` is set, because the SDK would print the key. Walked against LiteLLM 1.103.0 through `@distilled.cloud/litellm`'s `key_management` operations (`/key/list`, `/key/generate`, `/key/update`, `/key/delete`).

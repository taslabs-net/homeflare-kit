---
'@homeflare/alchemy': patch
---

`LiteLLM.PassThroughEndpoint` can be yielded from an Alchemy stack body. The proxy credentials stay on the provider layer, and that layer keeps them available when the engine calls the handlers.

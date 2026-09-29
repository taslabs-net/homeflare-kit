---
'@homeflare/distilled-litellm': minor
---

Regenerate from LiteLLM v1.103.0 (was v1.100.0): 964 operations across 91
service modules, from the proxy's own `app.openapi()` dumped at tag `v1.103.0`
and cross-checked byte for byte against the tag's committed dashboard types.

⚠️ **Removed modules.** LiteLLM moved the routes of fifteen per-provider
`* Pass-through` tags under one `llm_passthrough` tag, so `anthropic_pass_through`,
`assembly_ai_eu_pass_through`, `assembly_ai_pass_through`,
`aws_comprehend_medical_pass_through`, `azure_ai_pass_through`,
`azure_pass_through`, `bedrock_pass_through`, `cohere_pass_through`,
`cursor_pass_through`, `google_ai_studio_pass_through`, `milvus_pass_through`,
`mistral_pass_through`, `vertex_ai_pass_through`, `vllm_pass_through` and
`watsonx_pass_through` no longer exist, and `Services.llmPassthrough` is new
(`open_ai_pass_through` shrank from 10 to 5 operations). The kit's own
consumers use only `budget_management` and `misc`.

Typed request bodies for `POST /rerank`, `/v1/rerank`, `/v2/rerank`
(`model`, `query`, `documents` required, plus the vendor's optional rerank
parameters) and `POST /mcp-rest/tools/call` (`name` required, `server_id`,
`arguments`). LiteLLM's handlers read the raw request body, so its OpenAPI
document declares none and these requests were `S.Struct({})`; the bodies come
from distilled patches grounded in the v1.103.0 source, not from edits to
generated files. Responses stay `body: unknown`. The existing `400`/`403`/`404`/
`409` error patches were re-measured against v1.103.0: every patched status is
still raised.

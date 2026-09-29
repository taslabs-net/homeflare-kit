---
'@homeflare/alchemy': patch
---

`LiteLLM.MCPServer` refuses, at plan time, a `serverName` or `alias` outside `^[A-Za-z0-9._]{1,128}$` and a declared blank `description`. LiteLLM 1.103 rejects those names only when applying (`validate_tool_name`), and a blank description is written but never copied into `mcp_info`, so the row would never converge. A changed `serverName` keeps the live tool prefix; declare `alias` to change it. `LitellmMcpServerDescriptionShadowedError` is exported from `@homeflare/alchemy/litellm`.
